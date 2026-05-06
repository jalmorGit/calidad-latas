import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const images = formData.getAll("images") as File[];

    if (!images.length) {
      return NextResponse.json(
        { error: "No se han recibido imágenes" },
        { status: 400 }
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
        detail: "auto",
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
