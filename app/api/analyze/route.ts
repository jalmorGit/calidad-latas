import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

const MAX_IMAGES = 6;
const MAX_TOTAL_BYTES = 35 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function formatMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
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
Indica que es un análisis preliminar pendiente de control de calidad humano.`,
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
