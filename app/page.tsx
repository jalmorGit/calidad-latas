"use client";

import { useRef, useState } from "react";
import { compressImage, formatMegabytes } from "./lib/image-compression";

const MAX_PHOTOS = 6;

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [uploadSummary, setUploadSummary] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function prepareFiles(selectedFiles: File[]) {
    const selected = selectedFiles.slice(0, MAX_PHOTOS);
    const originalBytes = selected.reduce((total, file) => total + file.size, 0);

    setIsPreparing(true);
    setResult("");
    setUploadSummary("Preparando fotos...");

    try {
      const compressed = await Promise.all(selected.map(compressImage));
      const compressedBytes = compressed.reduce(
        (total, file) => total + file.size,
        0
      );

      setFiles(compressed);
      setUploadSummary(
        `${compressed.length} foto${compressed.length === 1 ? "" : "s"} lista${
          compressed.length === 1 ? "" : "s"
        }: ${formatMegabytes(originalBytes)} -> ${formatMegabytes(
          compressedBytes
        )}`
      );
    } catch (error) {
      setFiles([]);
      setUploadSummary("");
      setResult(error instanceof Error ? error.message : "Error preparando fotos.");
    } finally {
      setIsPreparing(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function analyze() {
    if (files.length === 0) {
      setResult("Primero anade fotos del pack.");
      return;
    }

    setIsAnalyzing(true);
    setResult("Analizando limpieza del pack...");

    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        setResult("Error:\n" + text);
        return;
      }

      const data = JSON.parse(text);
      setResult(data.result || "Sin resultado");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-500">
              Inspeccion preliminar
            </p>
            <h2 className="mt-1 text-2xl font-bold leading-tight text-slate-950">
              Pack de latas de aluminio
            </h2>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            Limpieza
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Fotos</p>
            <p className="mt-1 text-xl font-bold text-slate-950">
              {files.length}
            </p>
          </div>
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Linea</p>
            <p className="mt-1 text-xl font-bold text-slate-950">A1</p>
          </div>
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Estado</p>
            <p className="mt-1 text-xl font-bold text-teal-700">
              {isAnalyzing ? "AI" : "OK"}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-teal-300 bg-teal-50 px-4 py-6 text-center">
            <span className="text-base font-bold text-teal-900">
              Anadir fotos del pack
            </span>
            <span className="mt-1 text-sm text-teal-700">
              Desde la app de fotos del movil o archivos
            </span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void prepareFiles(Array.from(e.target.files || []));
            }}
          />
        </label>

        {uploadSummary ? (
          <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
            {uploadSummary}
          </p>
        ) : null}

        <button
          onClick={analyze}
          disabled={isAnalyzing || isPreparing}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isPreparing
            ? "Preparando fotos..."
            : isAnalyzing
              ? "Analizando..."
              : "Analizar limpieza"}
        </button>
      </section>

      <section className="flex flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950">Resultado</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Pendiente CQ
          </span>
        </div>

        <pre className="mt-3 min-h-44 flex-1 whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm leading-6 text-slate-50">
          {result ||
            "Sin analisis todavia. Captura fotos claras del pack antes de enviarlo a limpieza."}
        </pre>
      </section>

      <footer className="pb-[calc(env(safe-area-inset-bottom)+4px)] text-center text-xs font-semibold text-slate-500">
        Control humano obligatorio antes de aceptar, penalizar o rechazar.
      </footer>
    </main>
  );
}
