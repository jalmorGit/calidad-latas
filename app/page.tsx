"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { compressImage, formatMegabytes } from "./lib/image-compression";

const REQUIRED_BALE_PHOTOS = 5;

export default function Home() {
  const [licensePlateFile, setLicensePlateFile] = useState<File | null>(null);
  const [baleFiles, setBaleFiles] = useState<File[]>([]);
  const [licensePlatePreview, setLicensePlatePreview] = useState("");
  const [balePreviews, setBalePreviews] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPreparingPlate, setIsPreparingPlate] = useState(false);
  const [isPreparingBales, setIsPreparingBales] = useState(false);
  const [uploadSummary, setUploadSummary] = useState("");
  const [missingPhotosMessage, setMissingPhotosMessage] = useState("");
  const plateInputRef = useRef<HTMLInputElement>(null);
  const balesInputRef = useRef<HTMLInputElement>(null);
  const licensePlatePreviewRef = useRef("");
  const balePreviewsRef = useRef<string[]>([]);

  const isPreparing = isPreparingPlate || isPreparingBales;
  const isReady = Boolean(licensePlateFile) && baleFiles.length === REQUIRED_BALE_PHOTOS;

  useEffect(() => {
    return () => {
      if (licensePlatePreviewRef.current) {
        URL.revokeObjectURL(licensePlatePreviewRef.current);
      }

      balePreviewsRef.current.forEach((previewUrl) => {
        URL.revokeObjectURL(previewUrl);
      });
    };
  }, []);

  function replaceLicensePlatePreview(file: File | null) {
    if (licensePlatePreviewRef.current) {
      URL.revokeObjectURL(licensePlatePreviewRef.current);
    }

    const previewUrl = file ? URL.createObjectURL(file) : "";
    licensePlatePreviewRef.current = previewUrl;
    setLicensePlatePreview(previewUrl);
  }

  function replaceBalePreviews(files: File[]) {
    balePreviewsRef.current.forEach((previewUrl) => {
      URL.revokeObjectURL(previewUrl);
    });

    const previewUrls = files.map((file) => URL.createObjectURL(file));
    balePreviewsRef.current = previewUrls;
    setBalePreviews(previewUrls);
  }

  function getMissingPhotosMessage() {
    const missingBalePhotos = REQUIRED_BALE_PHOTOS - baleFiles.length;
    const missingItems: string[] = [];

    if (!licensePlateFile) {
      missingItems.push("la foto de la matricula");
    }

    if (missingBalePhotos > 0) {
      missingItems.push(
        `${missingBalePhotos} foto${missingBalePhotos === 1 ? "" : "s"} de fardos`
      );
    }

    if (!missingItems.length) {
      return "";
    }

    return `Falta ${missingItems.join(" y ")} para poder analizar el camion.`;
  }

  async function prepareLicensePlate(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsPreparingPlate(true);
    setResult("");
    setUploadSummary("Preparando foto de matricula...");

    try {
      const compressed = await compressImage(file);
      setLicensePlateFile(compressed);
      replaceLicensePlatePreview(compressed);
      setMissingPhotosMessage("");
      setUploadSummary(
        `Matricula lista: ${formatMegabytes(file.size)} -> ${formatMegabytes(
          compressed.size
        )}`
      );
    } catch (error) {
      setLicensePlateFile(null);
      replaceLicensePlatePreview(null);
      setUploadSummary("");
      setResult(
        error instanceof Error ? error.message : "Error preparando la matricula."
      );
    } finally {
      setIsPreparingPlate(false);

      if (plateInputRef.current) {
        plateInputRef.current.value = "";
      }
    }
  }

  async function prepareBaleFiles(selectedFiles: File[]) {
    const selected = selectedFiles.slice(0, REQUIRED_BALE_PHOTOS);
    const originalBytes = selected.reduce((total, file) => total + file.size, 0);

    setIsPreparingBales(true);
    setResult("");
    setUploadSummary("Preparando fotos de fardos...");

    try {
      const compressed = await Promise.all(selected.map(compressImage));
      const compressedBytes = compressed.reduce(
        (total, file) => total + file.size,
        0
      );

      setBaleFiles(compressed);
      replaceBalePreviews(compressed);
      setMissingPhotosMessage("");
      setUploadSummary(
        `${compressed.length}/${REQUIRED_BALE_PHOTOS} fotos de fardos listas: ${formatMegabytes(
          originalBytes
        )} -> ${formatMegabytes(compressedBytes)}`
      );
    } catch (error) {
      setBaleFiles([]);
      replaceBalePreviews([]);
      setUploadSummary("");
      setResult(error instanceof Error ? error.message : "Error preparando fotos.");
    } finally {
      setIsPreparingBales(false);

      if (balesInputRef.current) {
        balesInputRef.current.value = "";
      }
    }
  }

  async function analyze() {
    const missingMessage = getMissingPhotosMessage();

    if (missingMessage) {
      setMissingPhotosMessage(missingMessage);
      return;
    }

    if (!licensePlateFile) {
      return;
    }

    setMissingPhotosMessage("");
    setIsAnalyzing(true);
    setResult("Leyendo matricula y analizando primera capa...");

    const formData = new FormData();
    formData.append("licensePlateImage", licensePlateFile);
    baleFiles.forEach((file) => formData.append("baleImages", file));

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        try {
          const data = JSON.parse(text);
          setResult("Error:\n" + (data.error || text));
        } catch {
          setResult("Error:\n" + text);
        }
        return;
      }

      const data = JSON.parse(text);
      const savedCount = Array.isArray(data.savedImages)
        ? data.savedImages.length
        : 0;
      const savedMessage = savedCount
        ? `\n\nFotos guardadas en Supabase: ${savedCount}`
        : "";

      setResult((data.result || "Sin resultado") + savedMessage);
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <>
    <main className="flex flex-1 flex-col gap-4 px-4 py-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-500">
              Recepcion de camion
            </p>
            <h2 className="mt-1 text-2xl font-bold leading-tight text-slate-950">
              Control de entrada
            </h2>
          </div>
          <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-800">
            Planta
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Matricula</p>
            <p className="mt-1 text-xl font-bold text-slate-950">
              {licensePlateFile ? "1/1" : "0/1"}
            </p>
          </div>
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Fardos</p>
            <p className="mt-1 text-xl font-bold text-slate-950">
              {baleFiles.length}/{REQUIRED_BALE_PHOTOS}
            </p>
          </div>
          <div className="rounded-md bg-slate-100 px-2 py-3">
            <p className="text-xs font-semibold text-slate-500">Estado</p>
            <p className="mt-1 text-xl font-bold text-teal-700">
              {isAnalyzing ? "AI" : isReady ? "OK" : "PEND"}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Paso 1</p>
            <h2 className="text-lg font-bold text-slate-950">Matricula</h2>
          </div>
          <span className="text-sm font-bold text-slate-500">
            {licensePlateFile ? "Lista" : "Pendiente"}
          </span>
        </div>

        <label className="mt-3 block">
          <span className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
            <span className="text-base font-bold text-slate-950">
              Hacer foto de la matricula
            </span>
            <span className="mt-1 text-sm text-slate-600">
              Frontal o trasera, bien enfocada
            </span>
          </span>
          <input
            ref={plateInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void prepareLicensePlate(e.target.files?.[0]);
            }}
          />
        </label>

        {licensePlatePreview ? (
          <div className="relative mt-3 h-36 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
            <Image
              src={licensePlatePreview}
              alt="Foto subida de la matricula"
              fill
              sizes="384px"
              unoptimized
              className="object-cover"
            />
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-slate-500">Paso 2</p>
            <h2 className="text-lg font-bold text-slate-950">
              Primera capa de fardos
            </h2>
          </div>
          <span className="text-sm font-bold text-slate-500">
            {baleFiles.length}/{REQUIRED_BALE_PHOTOS}
          </span>
        </div>

        <label className="mt-3 block">
          <span className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-teal-300 bg-teal-50 px-4 py-6 text-center">
            <span className="text-base font-bold text-teal-900">
              Anadir 5 fotos de fardos
            </span>
            <span className="mt-1 text-sm text-teal-700">
              Fotos claras de la primera capa visible del camion
            </span>
          </span>
          <input
            ref={balesInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              void prepareBaleFiles(Array.from(e.target.files || []));
            }}
          />
        </label>

        {balePreviews.length ? (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {balePreviews.map((previewUrl, index) => (
              <div
                key={previewUrl}
                className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100"
              >
                <Image
                  src={previewUrl}
                  alt={`Foto subida de fardos ${index + 1}`}
                  fill
                  sizes="70px"
                  unoptimized
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}

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
              : "Analizar camion"}
        </button>
      </section>

      <section className="flex flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950">Resultado</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Control humano
          </span>
        </div>

        <pre className="mt-3 min-h-44 flex-1 whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm leading-6 text-slate-50">
          {result ||
            "Sin analisis todavia. Captura primero la matricula y despues 5 fotos de la primera capa de fardos."}
        </pre>
      </section>

      <footer className="pb-[calc(env(safe-area-inset-bottom)+4px)] text-center text-xs font-semibold text-slate-500">
        Control humano obligatorio antes de aceptar, penalizar o rechazar.
      </footer>
    </main>
    {missingPhotosMessage ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-photos-title"
      >
        <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
          <h2
            id="missing-photos-title"
            className="text-xl font-bold text-slate-950"
          >
            Faltan fotos
          </h2>
          <p className="mt-2 text-base leading-6 text-slate-700">
            {missingPhotosMessage}
          </p>
          <button
            type="button"
            onClick={() => setMissingPhotosMessage("")}
            className="mt-5 flex h-11 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-base font-bold text-white shadow-sm active:scale-[0.99]"
          >
            Entendido
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}
