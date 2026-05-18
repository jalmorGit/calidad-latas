import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

const REQUIRED_BALE_IMAGES = 5;
const MAX_IMAGES = 1 + REQUIRED_BALE_IMAGES;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const TRAINING_EXAMPLE_POOL_SIZE = 30;
const MAX_TRAINING_EXAMPLES = Number(
  process.env.ANALYSIS_TRAINING_EXAMPLES || 4
);
const ANALYSIS_BUCKET = process.env.SUPABASE_ANALYSIS_BUCKET || "pedido-fotos";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type TrainingExample = {
  image_url: string | null;
  score: number | null;
  dirt_level: string | null;
  contaminants: string[] | string | null;
  decision: string | null;
  notes: string | null;
};

const ANALYSIS_PROMPT = `Analiza una recepcion de camion en una planta de reciclaje.

Primero recibiras UNA imagen de la matricula del camion.
Despues recibiras CINCO imagenes de la primera capa visible de fardos de botes.

Tareas:
1. Lee la matricula del camion. Si no se ve con seguridad, indica "NO LEGIBLE".
2. Analiza solo las cinco fotos de fardos para estimar la calidad de la carga.

IMPORTANTE:
Los porcentajes deben estimarse EN PESO, no por volumen visible.

Ten en cuenta:
- El plástico, papel y cartón ocupan mucho volumen visual pero pesan muy poco frente al aluminio.
- Aunque se vea bastante plástico o papel, el porcentaje de aluminio puede seguir siendo muy alto.
- Si ves papeles, etiquetas, albaranes o carteles usados para identificar la procedencia del fardo, NO los cuentes como impropios ni penalizacion.
- Solo penaliza papel/carton cuando parezca material mezclado dentro del fardo, no documentacion externa de identificacion.
- El barro, tierra, humedad y residuos pesados sí penalizan mucho porque añaden peso real.
- La imagen solo muestra parte del fardo, así que la estimación es aproximada.

El objetivo principal es estimar:
1. porcentaje de aluminio
2. porcentaje total de impropios
3. desglose de impropios por tipo de material

Los impropios pueden incluir:
- plástico
- papel
- cartón
- aerosoles
- barro o tierra
- humedad
- móviles o aparatos electrónicos
- basura general
- otros metales
- textiles
- madera
- vidrio
- cualquier otro material visible

Devuelve SOLO este formato:

MATRICULA: XXXXXXX

% ESTIMADO ALUMINIO: XX%
% IMPROPIOS: XX%

DESGLOSE IMPROPIOS:
- Plástico: X%
- Papel/cartón: X%
- Barro/humedad: X%
- Aerosoles: X%
- Otros metales: X%
- Otros: X%

(RECUERDA:
los porcentajes deben estimarse EN PESO, no por volumen visual.)

RECOMENDACIÓN:
- ACEPTAR → si el aluminio estimado es superior al 80%
- REVISAR → si está entre 66% y 80%
- AVISAR ANTES DE DESCARGAR → si es 65% o menor

La RECOMENDACIÓN es obligatoria. No omitas nunca este bloque.

REFERENCIA PRIMERA CAPA:
- indica en una frase si la primera capa parece limpia, revisable o problematica

PENALIZACIÓN PRINCIPAL:
- indica el principal motivo de pérdida de calidad

No añadas razonamientos largos ni explicaciones técnicas.
Respuesta breve, clara y operativa para personal de planta.`;

function formatMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buffer.toString("base64")}`;
}

function getSupabaseConfig(requireServiceRole = false) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serverKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  const supabaseKey = requireServiceRole
    ? serverKey
    : serverKey || process.env.SUPABASE_KEY;

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

function getRecommendation(aluminumPercent: number) {
  if (aluminumPercent > 80) {
    return "ACEPTAR";
  }

  if (aluminumPercent > 65) {
    return "REVISAR";
  }

  return "AVISAR ANTES DE DESCARGAR";
}

function ensureRecommendation(result: string) {
  if (/RECOMENDACI[ÓO]N:/i.test(result)) {
    return result;
  }

  const match = result.match(/%\s*ESTIMADO\s+ALUMINIO:\s*(\d{1,3})\s*%/i);

  if (!match) {
    return result;
  }

  const aluminumPercent = Number(match[1]);
  const recommendation = `RECOMENDACIÓN:\n${getRecommendation(aluminumPercent)}`;

  if (/PENALIZACI[ÓO]N\s+PRINCIPAL:/i.test(result)) {
    return result.replace(
      /PENALIZACI[ÓO]N\s+PRINCIPAL:/i,
      `${recommendation}\n\nPENALIZACIÓN PRINCIPAL:`
    );
  }

  return `${result.trim()}\n\n${recommendation}`;
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
    "image_url,score,dirt_level,contaminants,decision,notes"
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(TRAINING_EXAMPLE_POOL_SIZE));

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

  const examples = ((await response.json()) as TrainingExample[]).filter(
    (example) => example.image_url
  );

  return examples
    .map((example) => ({ example, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, MAX_TRAINING_EXAMPLES)
    .map(({ example }) => example);
}

async function uploadAnalyzedImage(
  supabaseUrl: string,
  supabaseKey: string,
  file: File,
  category: "matricula" | "fardos"
) {
  const extension = file.type.split("/")[1] || "jpg";
  const today = new Date().toISOString().slice(0, 10);
  const path = `${today}/${category}/${Date.now()}-${crypto.randomUUID()}-${sanitizeFileName(
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

async function uploadAnalyzedImages(licensePlateImage: File, baleImages: File[]) {
  const supabaseConfig = getSupabaseConfig(true);

  if (!supabaseConfig) {
    throw new Error("No se pudo cargar la configuracion de Supabase.");
  }

  const { supabaseUrl, supabaseKey } = supabaseConfig;

  const uploadedLicensePlate = await uploadAnalyzedImage(
    supabaseUrl,
    supabaseKey,
    licensePlateImage,
    "matricula"
  );
  const uploadedBales = await Promise.all(
    baleImages.map((image) =>
      uploadAnalyzedImage(supabaseUrl, supabaseKey, image, "fardos")
    )
  );

  return [uploadedLicensePlate, ...uploadedBales];
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const licensePlateImage = formData.get("licensePlateImage");
    const baleImages = formData
      .getAll("baleImages")
      .filter((value): value is File => value instanceof File);
    const legacyImages = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File);

    const normalizedLicensePlateImage =
      licensePlateImage instanceof File ? licensePlateImage : legacyImages[0];
    const normalizedBaleImages = baleImages.length
      ? baleImages
      : legacyImages.slice(1);
    const images = normalizedLicensePlateImage
      ? [normalizedLicensePlateImage, ...normalizedBaleImages]
      : normalizedBaleImages;

    if (!normalizedLicensePlateImage) {
      return NextResponse.json(
        { error: "Falta la foto de la matricula del camion." },
        { status: 400 }
      );
    }

    if (normalizedBaleImages.length !== REQUIRED_BALE_IMAGES) {
      return NextResponse.json(
        {
          error: `Necesitas exactamente ${REQUIRED_BALE_IMAGES} fotos de fardos.`,
        },
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

    const trainingExamplesPromise = getTrainingExamples().catch((error) => {
      console.error("ERROR TRAINING EXAMPLES:", error);
      return [] as TrainingExample[];
    });
    const uploadedImagesPromise = uploadAnalyzedImages(
      normalizedLicensePlateImage,
      normalizedBaleImages
    );
    const licensePlateImageDataUrlPromise = fileToDataUrl(
      normalizedLicensePlateImage
    );
    const newImageDataUrlsPromise = Promise.all(
      normalizedBaleImages.map(fileToDataUrl)
    );

    const [
      uploadedImages,
      trainingExamples,
      licensePlateImageDataUrl,
      newImageDataUrls,
    ] = await Promise.all([
      uploadedImagesPromise,
      trainingExamplesPromise,
      licensePlateImageDataUrlPromise,
      newImageDataUrlsPromise,
    ]);
    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: `${ANALYSIS_PROMPT}

La siguiente imagen corresponde a la matricula del camion. Usala solo para leer la matricula, no para evaluar la calidad de los fardos.`,
      },
      {
        type: "input_image",
        image_url: licensePlateImageDataUrl,
        detail: "low",
      },
      {
        type: "input_text",
        text: "Antes de analizar las fotos nuevas de fardos, usa estos ejemplos reales del cliente solo como calibracion breve de criterio. No hay imagenes de ejemplo en esta peticion: prioriza siempre el formato de salida indicado.",
      },
    ];

    for (const [index, example] of trainingExamples.entries()) {
      content.push({
        type: "input_text",
        text: `Ejemplo real ${index + 1} del cliente:
- puntuacion cliente: ${example.score ?? "no indicada"}
- nivel de suciedad: ${example.dirt_level || "no indicado"}
- decision cliente: ${example.decision || "no indicada"}
- contaminantes: ${formatContaminants(example.contaminants)}
- observaciones: ${example.notes || "sin observaciones"}`,
      });
    }

    content.push({
      type: "input_text",
      text: "Ahora analiza las siguientes cinco fotos nuevas de la primera capa de fardos del camion. No son ejemplos: son las imagenes que debes evaluar usando el prompt principal y la calibracion anterior.",
    });

    for (const imageDataUrl of newImageDataUrls) {
      content.push({
        type: "input_image",
        image_url: imageDataUrl,
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
      max_output_tokens: 280,
    });

    const result = ensureRecommendation(response.output_text);

    return NextResponse.json({
      result,
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
