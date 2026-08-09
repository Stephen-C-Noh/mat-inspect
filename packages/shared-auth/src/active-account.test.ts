import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo, EventMessage, IPublicClientApplication } from '@azure/msal-browser';
import { EventType } from '@azure/msal-browser';
import { getActiveAccount, wireActiveAccount } from './active-account';

const accountA = { homeAccountId: 'a', username: 'a@sait.ca' } as AccountInfo;
const accountB = { homeAccountId: 'b', username: 'b@sait.ca' } as AccountInfo;

const makeInstance = (overrides: Partial<IPublicClientApplication>): IPublicClientApplication =>
  ({
    getActiveAccount: vi.fn().mockReturnValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    setActiveAccount: vi.fn(),
    addEventCallback: vi.fn(),
    removeEventCallback: vi.fn(),
    clearCache: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as IPublicClientApplication;

describe('getActiveAccount', () => {
  it('prefers the MSAL-designated active account over accounts[0]', () => {
    const instance = makeInstance({ getActiveAccount: vi.fn().mockReturnValue(accountB) });
    expect(getActiveAccount(instance, [accountA, accountB])).toBe(accountB);
  });

  it('falls back to accounts[0] when no active account is designated', () => {
    const instance = makeInstance({ getActiveAccount: vi.fn().mockReturnValue(null) });
    expect(getActiveAccount(instance, [accountA, accountB])).toBe(accountA);
  });

  it('returns null when there is no active account and no cached account', () => {
    const instance = makeInstance({});
    expect(getActiveAccount(instance, [])).toBeNull();
  });

  it('does not throw against a test double with no getActiveAccount method', () => {
    const instance = { getActiveAccount: undefined } as unknown as IPublicClientApplication;
    expect(getActiveAccount(instance, [accountA])).toBe(accountA);
  });
});

describe('wireActiveAccount', () => {
  it('bootstraps the active account from the cache when exactly one is cached', () => {
    const setActiveAccount = vi.fn();
    const instance = makeInstance({
      getActiveAccount: vi.fn().mockReturnValue(null),
      getAllAccounts: vi.fn().mockReturnValue([accountA]),
      setActiveAccount,
    });

    wireActiveAccount(instance);

    expect(setActiveAccount).toHaveBeenCalledWith(accountA);
  });

  it('does not overwrite an already-designated active account on bootstrap', () => {
    const setActiveAccount = vi.fn();
    const instance = makeInstance({
      getActiveAccount: vi.fn().mockReturnValue(accountB),
      getAllAccounts: vi.fn().mockReturnValue([accountA, accountB]),
      setActiveAccount,
    });

    wireActiveAccount(instance);

    expect(setActiveAccount).not.toHaveBeenCalled();
  });

  it('does not guess between two or more cached accounts with no active designation', () => {
    // A targeted sign-out (account-menu, switch-account-button) removes one cached account
    // and can leave others behind. Auto-promoting one would be exactly the identity
    // misattribution CLAUDE.md Part 6 rules out, so this clears everything and forces a
    // real re-login instead.
    const setActiveAccount = vi.fn();
    const clearCache = vi.fn().mockResolvedValue(undefined);
    const instance = makeInstance({
      getActiveAccount: vi.fn().mockReturnValue(null),
      getAllAccounts: vi.fn().mockReturnValue([accountA, accountB]),
      setActiveAccount,
      clearCache,
    });

    wireActiveAccount(instance);

    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalled();
  });

  it('does nothing on bootstrap when no account is cached', () => {
    const setActiveAccount = vi.fn();
    const clearCache = vi.fn();
    const instance = makeInstance({
      getActiveAccount: vi.fn().mockReturnValue(null),
      getAllAccounts: vi.fn().mockReturnValue([]),
      setActiveAccount,
      clearCache,
    });

    wireActiveAccount(instance);

    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();
  });

  it('sets the active account on LOGIN_SUCCESS', () => {
    const setActiveAccount = vi.fn();
    let callback: ((event: EventMessage) => void) | undefined;
    const instance = makeInstance({
      addEventCallback: vi.fn((cb) => {
        callback = cb as (event: EventMessage) => void;
        return null;
      }),
      setActiveAccount,
    });

    wireActiveAccount(instance);
    callback?.({
      eventType: EventType.LOGIN_SUCCESS,
      payload: { account: accountB },
    } as EventMessage);

    expect(setActiveAccount).toHaveBeenCalledWith(accountB);
  });

  it('sets the active account on ACQUIRE_TOKEN_SUCCESS', () => {
    const setActiveAccount = vi.fn();
    let callback: ((event: EventMessage) => void) | undefined;
    const instance = makeInstance({
      addEventCallback: vi.fn((cb) => {
        callback = cb as (event: EventMessage) => void;
        return null;
      }),
      setActiveAccount,
    });

    wireActiveAccount(instance);
    callback?.({
      eventType: EventType.ACQUIRE_TOKEN_SUCCESS,
      payload: { account: accountB },
    } as EventMessage);

    expect(setActiveAccount).toHaveBeenCalledWith(accountB);
  });

  it('ignores unrelated events and events with no account in the payload', () => {
    const setActiveAccount = vi.fn();
    let callback: ((event: EventMessage) => void) | undefined;
    const instance = makeInstance({
      addEventCallback: vi.fn((cb) => {
        callback = cb as (event: EventMessage) => void;
        return null;
      }),
      setActiveAccount,
    });

    wireActiveAccount(instance);
    callback?.({ eventType: EventType.LOGOUT_SUCCESS, payload: null } as EventMessage);
    callback?.({ eventType: EventType.LOGIN_SUCCESS, payload: {} } as EventMessage);

    expect(setActiveAccount).not.toHaveBeenCalled();
  });

  it('removes its event callback when the returned cleanup runs', () => {
    // Guards against React StrictMode's dev double-invoke (mount, unmount, mount)
    // registering this callback twice.
    const removeEventCallback = vi.fn();
    const instance = makeInstance({
      addEventCallback: vi.fn().mockReturnValue('callback-id'),
      removeEventCallback,
    });

    const cleanup = wireActiveAccount(instance);
    cleanup();

    expect(removeEventCallback).toHaveBeenCalledWith('callback-id');
  });

  it('does nothing on cleanup when addEventCallback returned no id', () => {
    const removeEventCallback = vi.fn();
    const instance = makeInstance({
      addEventCallback: vi.fn().mockReturnValue(null),
      removeEventCallback,
    });

    const cleanup = wireActiveAccount(instance);
    cleanup();

    expect(removeEventCallback).not.toHaveBeenCalled();
  });
});
