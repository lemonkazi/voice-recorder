from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import speech_recognition as sr
from pydub import AudioSegment
import tempfile
import os
import uvicorn
from typing import Dict, Any

app = FastAPI(title="Audio Transcription API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def convert_to_wav(input_path: str, output_path: str = None) -> str:
    """Convert any audio format to WAV for speech recognition"""
    if output_path is None:
        output_path = tempfile.mktemp(suffix='.wav')
    
    # Load audio file using pydub (requires ffmpeg)
    audio = AudioSegment.from_file(input_path)
    # Convert to mono, 16kHz for better speech recognition
    audio = audio.set_frame_rate(16000).set_channels(1)
    audio.export(output_path, format="wav")
    return output_path

@app.get("/")
async def health_check():
    return {"status": "healthy", "message": "Audio Transcription API with FFmpeg support is running"}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio file to text - supports multiple formats with FFmpeg
    """
    try:
        # Validate file type
        allowed_types = [
            'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 
            'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/flac'
        ]
        allowed_extensions = ['.mp3', '.wav', '.webm', '.ogg', '.m4a', '.mp4', '.flac', '.mpeg']
        
        file_extension = os.path.splitext(file.filename.lower())[1]
        if file.content_type not in allowed_types and file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported file type. Supported formats: MP3, WAV, WebM, OGG, M4A, MP4, FLAC"
            )

        # Read file content
        content = await file.read()
        
        # Create temporary input file
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension) as input_temp_file:
            input_temp_file.write(content)
            input_path = input_temp_file.name

        wav_path = None
        try:
            # Convert to WAV format using FFmpeg
            wav_path = convert_to_wav(input_path)
            
            # Initialize recognizer
            recognizer = sr.Recognizer()
            
            # Transcribe audio
            with sr.AudioFile(wav_path) as source:
                # Adjust for ambient noise
                recognizer.adjust_for_ambient_noise(source, duration=0.5)
                audio_data = recognizer.record(source)
                
                # Try Google Web Speech API first
                try:
                    text = recognizer.recognize_google(audio_data)
                    engine = "google_web_speech"
                    success = True
                    message = "Transcription completed successfully"
                    
                except sr.UnknownValueError:
                    text = ""
                    engine = "google_web_speech"
                    success = True
                    message = "Audio was clear but no speech could be understood"
                    
                except sr.RequestError as e:
                    # Fallback to Sphinx (offline)
                    try:
                        text = recognizer.recognize_sphinx(audio_data)
                        engine = "sphinx_offline"
                        success = True
                        message = "Transcription completed using offline engine"
                    except sr.UnknownValueError:
                        text = ""
                        engine = "sphinx_offline"
                        success = True
                        message = "Offline engine could not understand audio"
                    except Exception as sphinx_error:
                        raise HTTPException(
                            status_code=500,
                            detail=f"All transcription engines failed: {str(sphinx_error)}"
                        )

            return {
                "success": success,
                "text": text,
                "engine": engine,
                "file_name": file.filename,
                "message": message,
                "file_type": file.content_type
            }
            
        finally:
            # Clean up temporary files
            if os.path.exists(input_path):
                os.unlink(input_path)
            if wav_path and os.path.exists(wav_path):
                os.unlink(wav_path)
                
    except HTTPException:
        raise
    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Transcription failed: {str(e)}"
        )

@app.get("/health")
async def detailed_health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "supported_formats": ["MP3", "WAV", "WebM", "OGG", "M4A", "MP4", "FLAC"],
        "engines": ["google_web_speech", "sphinx_offline"],
        "note": "FFmpeg required for non-WAV formats"
    }

@app.get("/test-ffmpeg")
async def test_ffmpeg():
    """Test if FFmpeg is working properly"""
    try:
        # Test FFmpeg by trying to convert a small audio segment
        test_audio = AudioSegment.silent(duration=1000)  # 1 second of silence
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp3') as temp_mp3:
            test_audio.export(temp_mp3.name, format="mp3")
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_wav:
            converted_path = convert_to_wav(temp_mp3.name, temp_wav.name)
            
        # Clean up
        os.unlink(temp_mp3.name)
        os.unlink(converted_path)
        
        return {"success": True, "message": "FFmpeg is working correctly"}
    except Exception as e:
        return {"success": False, "error": f"FFmpeg test failed: {str(e)}"}

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )