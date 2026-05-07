import { NextRequest, NextResponse } from "next/server";

const TRAINING_BUCKET =
  process.env.SUPABASE_TRAINING_BUCKET || "training-images";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Faltan SUPABASE_URL y SUPABASE_KEY en .env.local");
  }

  return { supabaseUrl, supabaseKey };
}

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseContaminants(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function uploadTrainingImage(
  supabaseUrl: string,
  supabaseKey: string,
  file: File
) {
  const extension = file.type.split("/")[1] || "jpg";
  const path = `${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(
    file.name
  )}.${extension}`;
  const uploadUrl = new URL(
    `/storage/v1/object/${TRAINING_BUCKET}/${path}`,
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
    throw new Error(`No se pudo subir la imagen a Supabase (${response.status})`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${TRAINING_BUCKET}/${path}`;
}

async function insertTrainingExample(
  supabaseUrl: string,
  supabaseKey: string,
  payload: {
    image_url: string;
    score: number;
    dirt_level: string;
    contaminants: string[];
    decision: string;
    notes: string;
  }
) {
  const insertUrl = new URL("/rest/v1/training_examples", supabaseUrl);

  const response = await fetch(insertUrl, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`No se pudo guardar el ejemplo (${response.status})`);
  }

  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const image = formData.get("image");
    const score = Number(formData.get("score"));
    const dirtLevel = String(formData.get("dirt_level") || "");
    const decision = String(formData.get("decision") || "");
    const notes = String(formData.get("notes") || "");
    const contaminants = parseContaminants(formData.get("contaminants"));

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Selecciona una foto del cliente." },
        { status: 400 }
      );
    }

    if (!SUPPORTED_IMAGE_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "Formato no compatible. Usa JPEG, PNG, WEBP o GIF." },
        { status: 400 }
      );
    }

    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "La foto es demasiado grande. Prueba con una version menor." },
        { status: 413 }
      );
    }

    if (!Number.isInteger(score) || score < 0 || score > 100) {
      return NextResponse.json(
        { error: "La puntuacion debe ser un numero de 0 a 100." },
        { status: 400 }
      );
    }

    if (!dirtLevel || !decision) {
      return NextResponse.json(
        { error: "Indica nivel de suciedad y decision del cliente." },
        { status: 400 }
      );
    }

    const { supabaseUrl, supabaseKey } = getSupabaseConfig();
    const imageUrl = await uploadTrainingImage(supabaseUrl, supabaseKey, image);
    const example = await insertTrainingExample(supabaseUrl, supabaseKey, {
      image_url: imageUrl,
      score,
      dirt_level: dirtLevel,
      contaminants,
      decision,
      notes,
    });

    return NextResponse.json({ example });
  } catch (error: unknown) {
    console.error("ERROR TRAINING EXAMPLE:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}
