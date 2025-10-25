import { NextResponse } from "next/server";

const PYTHON_API_URL = "http://localhost:8502/transcribe";


export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file uploaded" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("audio/")) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Only audio files are allowed." },
        { status: 400 }
      );
    }

    // Validate file size (25MB max)
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: "File too large. Maximum size is 25MB." },
        { status: 400 }
      );
    }

    // Forward to Python API
    const pythonFormData = new FormData();
    pythonFormData.append("file", file);

    const response = await fetch(PYTHON_API_URL, {
      method: "POST",
      body: pythonFormData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Python API error: ${response.status}`);
    }

    const transcriptionResult = await response.json();

    return NextResponse.json({
      success: true,
      ...transcriptionResult,
      message: "File transcribed successfully"
    });

  } catch (error) {
    console.error("Upload/Transcription error:", error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Transcription failed",
        message: "Failed to process audio file"
      },
      { status: 500 }
    );
  }
}