// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePhotoUpload } from './use-photo-upload';

const PHOTO_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }) },
    accounts: [
      {
        homeAccountId: 'home-id',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant-id',
        localAccountId: 'local-id',
        username: 'jane.doe@example.edu',
        name: 'Jane Doe',
        idTokenClaims: { roles: ['operator'] },
      },
    ],
  }),
}));

// jsdom has no real object URL implementation; the hook only needs a stable stand-in.
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:mock-preview-url');
      static revokeObjectURL = vi.fn();
    },
  );
});

describe('usePhotoUpload', () => {
  it('transitions to uploaded with the returned photoId on a successful upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            photoId: PHOTO_ID,
            container: 'evidence-photos',
            blobName: `${PHOTO_ID}.jpg`,
            contentType: 'image/jpeg',
            size: 1024,
            sha256: 'a'.repeat(64),
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const { result } = renderHook(() => usePhotoUpload());
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    act(() => {
      result.current.upload(file);
    });

    expect(result.current.state).toMatchObject({ status: 'uploading' });

    await waitFor(() => expect(result.current.state.status).toBe('uploaded'));
    expect(result.current.state).toMatchObject({ status: 'uploaded', photoId: PHOTO_ID });
  });

  it('surfaces a retry-friendly error when the server rejects the upload', async () => {
    // 400 is not retryable (retry-policy RETRYABLE_CLIENT_STATUSES), so this resolves without
    // waiting through the real backoff schedule.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));

    const { result } = renderHook(() => usePhotoUpload());
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

    act(() => {
      result.current.upload(file);
    });

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({
      status: 'error',
      message: expect.stringContaining('try again'),
    });
  });

  it('clears back to idle and revokes the preview URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:mock-preview-url');
        static revokeObjectURL = revokeObjectURL;
      },
    );

    const { result } = renderHook(() => usePhotoUpload());
    act(() => {
      result.current.upload(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toEqual({ status: 'idle' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  it('drops an upload that finishes after the operator removed the photo', async () => {
    // Otherwise the removal silently undoes itself: the request lands, onUploaded fires, and the id
    // the operator just deleted is written back into the draft and submitted as evidence.
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );

    const onUploaded = vi.fn();
    const { result } = renderHook(() => usePhotoUpload(onUploaded));

    act(() => {
      result.current.upload(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    });
    expect(result.current.state.status).toBe('uploading');

    act(() => {
      result.current.clear();
    });

    await act(async () => {
      release(
        new Response(
          JSON.stringify({
            photoId: PHOTO_ID,
            container: 'evidence-photos',
            blobName: `${PHOTO_ID}.jpg`,
            contentType: 'image/jpeg',
            size: 1024,
            sha256: 'a'.repeat(64),
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    expect(onUploaded).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('revokes the preview URL when the card unmounts', async () => {
    // The card holding this hook unmounts on collapse and when the item is re-marked as passing, so
    // an un-revoked preview holds the camera blob for the life of the page.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => 'blob:mock-preview-url');
        static revokeObjectURL = revokeObjectURL;
      },
    );

    const { result, unmount } = renderHook(() => usePhotoUpload());
    act(() => {
      result.current.upload(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  it('revokes the previous preview URL when the operator retakes the photo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    const revokeObjectURL = vi.fn();
    let created = 0;
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => `blob:preview-${created++}`);
        static revokeObjectURL = revokeObjectURL;
      },
    );

    const { result } = renderHook(() => usePhotoUpload());
    act(() => {
      result.current.upload(new File(['x'], 'first.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(result.current.state.status).toBe('error'));

    act(() => {
      result.current.upload(new File(['x'], 'retake.jpg', { type: 'image/jpeg' }));
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-0');
  });
});
