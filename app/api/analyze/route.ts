import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

const MAX_IMAGES = 6;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const TRAINING_EXAMPLE_POOL_SIZE = 60;
const MAX_TRAINING_EXAMPLES = 10;
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

const ANALYSIS_PROMPT = `Analiza estas imágenes de fardos o paquetes de latas de aluminio procedentes de un camión o pedido de reciclaje.

Tu objetivo principal es estimar la composición EN PESO, no en volumen visual.

Muy importante:

- No calcules los porcentajes por la superficie visible en la imagen.
- Estima los porcentajes según el peso probable de cada material.
- El plástico, el papel y el cartón pueden ocupar mucho volumen visual pero pesan muy poco frente al aluminio compactado.
- Por tanto, aunque se vea bastante plástico o papel, el porcentaje en peso de impropios puede ser bajo.
- El barro, la tierra, la humedad y los restos orgánicos sí pueden penalizar mucho más porque añaden peso real y reducen la calidad del material.
- La imagen solo muestra el frente o una parte del fardo, así que debes indicar siempre el nivel de incertidumbre.

Material principal esperado:

- Latas de aluminio compactadas.

Impropios habituales:

- Plástico
- Papel
- Cartón
- Basura general
- Barro o tierra
- Humedad
- Otros metales o botes no deseados
- Objetos extraños

Devuelve el resultado en este formato:

1. Porcentaje estimado EN PESO:

- Aluminio/latas: X%
- Impropios totales: X%
- Humedad/barro/tierra: X%
- Otros materiales: X%

2. Calidad estimada:

- Excelente / buena / media / baja / rechazable

3. Puntuación de calidad:

- 0 a 100

4. Penalización principal:

- Indica qué material o factor reduce más la calidad.

5. Razonamiento:

- Explica brevemente por qué has estimado esos porcentajes en peso.
- Si hay mucho plástico o papel visible, recuerda valorar que su peso relativo puede ser pequeño.
- Si hay barro, humedad o tierra, penaliza más porque aportan peso y deterioran el material.

6. Recomendación:

- aceptar
- aceptar con penalización
- revisar manualmente
- rechazar

7. Incertidumbre:

- baja / media / alta
- Explica si la foto no permite ver suficiente profundidad del fardo.

Regla de criterio:

Un fardo puede tener un 85%-95% de aluminio en peso aunque visualmente aparezcan plásticos o papeles, siempre que esos impropios sean ligeros y no haya barro, humedad intensa o basura pesada.

No des una respuesta excesivamente optimista. Si solo se ve una parte del fardo, indica que es una estimación preliminar pendiente de control de calidad humano.`;

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

    const content: ResponseInputContent[] = [
      {
        type: "input_text",
        text: `${ANALYSIS_PROMPT}

Antes de analizar las fotos nuevas, revisa los siguientes ejemplos reales del cliente. Cada ejemplo incluye una foto ya evaluada y su criterio humano. Utiliza estos ejemplos para calibrar la puntuacion, la decision y la severidad de los impropios en peso.`,
      },
    ];

    trainingExamples.forEach((example, index) => {
      content.push({
        type: "input_text",
        text: `Ejemplo real ${index + 1} del cliente:
- puntuacion cliente: ${example.score ?? "no indicada"}
- nivel de suciedad: ${example.dirt_level || "no indicado"}
- decision cliente: ${example.decision || "no indicada"}
- contaminantes: ${formatContaminants(example.contaminants)}
- observaciones: ${example.notes || "sin observaciones"}`,
      });

      if (example.image_url) {
        content.push({
          type: "input_image",
          image_url: example.image_url,
          detail: "low",
        });
      }
    });

    content.push({
      type: "input_text",
      text: "Ahora analiza las siguientes fotos nuevas del pedido/camion. No son ejemplos: son las imagenes que debes evaluar usando el prompt principal y la calibracion anterior.",
    });

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
