"use client";

import { FormEvent, useRef, useState } from "react";
import { compressImage, formatMegabytes } from "../lib/image-compression";

const DECISIONS = ["aceptar", "penalizar", "revisar", "rechazar"];
const DIRT_LEVELS = ["bajo", "medio", "alto", "muy alto"];

export default function TrainingPage() {
  const [image, setImage] = useState<File | null>(null);
  const [imageSummary, setImageSummary] = useState("");
  const [status, setStatus] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function prepareImage(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsPreparing(true);
    setStatus("");
    setImageSummary("Preparando foto...");

    try {
      const compressed = await compressImage(file);
      setImage(compressed);
      setImageSummary(
        `${file.name}: ${formatMegabytes(file.size)} -> ${formatMegabytes(
          compressed.size
        )}`
      );
    } catch (error) {
      setImage(null);
      setImageSummary("");
      setStatus(error instanceof Error ? error.message : "Error preparando foto.");
    } finally {
      setIsPreparing(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function saveExample(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!image) {
      setStatus("Primero anade una foto del cliente.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    formData.set("image", image);

    setIsSaving(true);
    setStatus("Guardando ejemplo...");

    try {
      const response = await fetch("/api/training-examples", {
        method: "POST",
        body: formData,
      });
      const text = await response.text();

      if (!response.ok) {
        setStatus("Error:\n" + text);
        return;
      }

      setStatus("Ejemplo guardado. Ya se usara en los siguientes analisis.");
      setImage(null);
      setImageSummary("");
      formRef.current?.reset();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">
          Aprendizaje cliente
        </p>
        <h2 className="mt-1 text-2xl font-bold leading-tight text-slate-950">
          Anadir ejemplo puntuado
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Cada ejemplo guardado calibra la escala de los proximos analisis.
        </p>
      </section>

      <form
        ref={formRef}
        onSubmit={saveExample}
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="block">
          <span className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-teal-300 bg-teal-50 px-4 py-5 text-center">
            <span className="text-base font-bold text-teal-900">
              Foto puntuacion cliente
            </span>
            <span className="mt-1 text-sm text-teal-700">
              Selecciona una imagen del movil
            </span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="hidden"
            onChange={(event) => {
              void prepareImage(event.target.files?.[0]);
            }}
          />
        </label>

        {imageSummary ? (
          <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
            {imageSummary}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">
              Puntuacion
            </span>
            <input
              name="score"
              type="number"
              min="0"
              max="100"
              required
              className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-semibold text-slate-950 outline-none focus:border-teal-600"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">
              Suciedad
            </span>
            <select
              name="dirt_level"
              required
              defaultValue=""
              className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-semibold text-slate-950 outline-none focus:border-teal-600"
            >
              <option value="" disabled>
                Elegir
              </option>
              {DIRT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-bold uppercase text-slate-500">
            Decision cliente
          </span>
          <select
            name="decision"
            required
            defaultValue=""
            className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base font-semibold text-slate-950 outline-none focus:border-teal-600"
          >
            <option value="" disabled>
              Elegir decision
            </option>
            {DECISIONS.map((decision) => (
              <option key={decision} value={decision}>
                {decision}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-bold uppercase text-slate-500">
            Contaminantes
          </span>
          <input
            name="contaminants"
            placeholder="plastico, carton, basura"
            className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-teal-600"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-bold uppercase text-slate-500">
            Observaciones
          </span>
          <textarea
            name="notes"
            rows={4}
            placeholder="Criterio observado por el cliente"
            className="mt-1 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none focus:border-teal-600"
          />
        </label>

        <button
          type="submit"
          disabled={isPreparing || isSaving}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isPreparing
            ? "Preparando foto..."
            : isSaving
              ? "Guardando..."
              : "Guardar ejemplo"}
        </button>
      </form>

      <pre className="min-h-24 whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm leading-6 text-slate-50">
        {status ||
          "Cuando guardes un ejemplo, entrara automaticamente en la calibracion del analisis."}
      </pre>
    </main>
  );
}
