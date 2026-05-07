import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

const MAX_IMAGES = 6;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const MAX_TRAINING_EXAMPLES = 12;
const ANALYSIS_BUCKET = process.env.SUPABASE_ANALYSIS_BUCKET || "pedido-fotos";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type TrainingExample = {
  score: number | null;
  dirt_level: string | null;
  contaminants: string[] | string | null;
  decision: string | null;
  notes: string | null;
};

function formatMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function getSupabaseConfig(requireServiceRole = false) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = requireServiceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (requireServiceRole) {
      throw new Error(
        "Para guardar fotos evaluadas necesitas SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local."
      );
    }

    return null;
  }

  if (
    supabaseUrl.includes("your-supabase-url") ||
    !supabaseUrl.startsWith("https://")
  ) {
    throw new Error(
      "SUPABASE_URL no es valida. Usa la Project URL real de Supabase."
    );
  }

  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), supabaseKey };
}

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatContaminants(contaminants: TrainingExample["contaminants"]) {
  if (Array.isArray(contaminants)) {
    return contaminants.length ? contaminants.join(", ") : "no indicado";
  }

  return contaminants || "no indicado";
}

function buildTrainingPrompt(examples: TrainingExample[]) {
  if (!examples.length) {
    return "";
  }

  const formattedExamples = examples
    .map((example, index) => {
      return `Ejemplo ${index + 1}:
- puntuacion cliente: ${example.score ?? "no indicada"}
- nivel de suciedad: ${example.dirt_level || "no indicado"}
- contaminantes: ${formatContaminants(example.contaminants)}
- decision cliente: ${example.decision || "no indicada"}
- observaciones: ${example.notes || "sin observaciones"}`;
    })
    .join("\n\n");

  return `\n\nEjemplos reales puntuados por el cliente para calibrar la escala:
${formattedExamples}

Usa estos ejemplos como referencia de calibracion. Si las nuevas imagenes se parecen a un ejemplo, ajusta la puntuacion y la decision de forma coherente con ese criterio del cliente.`;
}

async function getTrainingExamples() {
  const supabaseConfig = getSupabaseConfig();

  if (!supabaseConfig) {
    return [];
  }

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  const url = new URL("/rest/v1/training_examples", supabaseUrl);
  url.searchParams.set(
    "select",
    "score,dirt_level,contaminants,decision,notes"
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(MAX_TRAINING_EXAMPLES));

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase respondio con estado ${response.status}`);
  }

  return (await response.json()) as TrainingExample[];
}

async function uploadAnalyzedImage(
  supabaseUrl: string,
  supabaseKey: string,
  file: File
) {
  const extension = file.type.split("/")[1] || "jpg";
  const today = new Date().toISOString().slice(0, 10);
  const path = `${today}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(
    file.name
  )}.${extension}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${ANALYSIS_BUCKET}/${path}`,
    supabaseUrl
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": file.type,
      "x-upsert": "false",
    },
    body: file,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `No se pudo subir la foto evaluada al bucket "${ANALYSIS_BUCKET}" de Supabase (${response.status}): ${errorText}`
    );
  }

  return {
    path,
    url: `${supabaseUrl}/storage/v1/object/public/${ANALYSIS_BUCKET}/${path}`,
  };
}

async function uploadAnalyzedImages(images: File[]) {
  const supabaseConfig = getSupabaseConfig(true);

  if (!supabaseConfig) {
    throw new Error("No se pudo cargar la configuracion de Supabase.");
  }

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  return Promise.all(
    images.map((image) => uploadAnalyzedImage(supabaseUrl, supabaseKey, image))
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const images = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File);

    if (!images.length) {
      return NextResponse.json(
        { error: "No se han recibido imágenes" },
        { status: 400 }
      );
    }

    if (images.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `Sube como maximo ${MAX_IMAGES} fotos por analisis.` },
        { status: 400 }
      );
    }

    const unsupportedImage = images.find(
      (image) => !SUPPORTED_IMAGE_TYPES.has(image.type)
    );

    if (unsupportedImage) {
      return NextResponse.json(
        {
          error:
            "Formato no compatible. Usa imagenes JPEG, PNG, WEBP o GIF no animado.",
        },
        { status: 400 }
      );
    }

    const totalBytes = images.reduce((total, image) => total + image.size, 0);

    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        {
          error: `Las fotos pesan ${formatMegabytes(
            totalBytes
          )}. Reduce la seleccion o sube fotos mas ligeras.`,
        },
        { status: 413 }
      );
    }

    const uploadedImages = await uploadAnalyzedImages(images);

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    let trainingExamples: TrainingExample[] = [];

    try {
      trainingExamples = await getTrainingExamples();
    } catch (error) {
      console.error("ERROR TRAINING EXAMPLES:", error);
    }

    const trainingPrompt = buildTrainingPrompt(trainingExamples);

    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: `Analiza estas imágenes de paquetes de latas de aluminio.
Devuelve:
- puntuación de calidad de 0 a 100
- nivel de suciedad
- contaminantes detectados: cartón, plástico, basura u objetos extraños
- recomendación: aceptar, penalizar, revisar o rechazar
- explicación breve.
Indica que es un análisis preliminar pendiente de control de calidad humano.${trainingPrompt}`,
      },
    ];

    for (const file of images) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString("base64");

      content.push({
        type: "input_image",
        image_url: `data:${file.type};base64,${base64}`,
        detail: "low",
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content,
        },
      ],
    });

    return NextResponse.json({
      result: response.output_text,
      trainingExamplesUsed: trainingExamples.length,
      savedImages: uploadedImages,
    });
  } catch (error: unknown) {
    console.error("ERROR ANALYZE:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}
