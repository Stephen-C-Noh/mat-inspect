'use client';

import { useRef, type PointerEvent, type ReactElement } from 'react';

type Props = {
  signed: boolean;
  onChange: (signed: boolean) => void;
};

export const SignaturePad = ({ signed, onChange }: Props): ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const getContext = () => canvasRef.current?.getContext('2d') ?? null;

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    drawingRef.current = true;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(true);
  };

  const handleClear = () => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={320}
        height={120}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full touch-none rounded-xl border border-slate-300 bg-white"
        aria-label="Signature capture area"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">
          {signed ? 'Signed' : 'Sign above'}
        </span>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
