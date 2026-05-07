import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

const MAX_IMAGES = 6;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const MAX_TRAINING_EXAMPLES = 12;
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
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return [];
  }

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
