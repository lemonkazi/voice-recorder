from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from enum import Enum
import speech_recognition as sr
from pydub import AudioSegment
import tempfile
import os
import uvicorn
from typing import Dict, Any, Optional
import logging
from abc import ABC, abstractmethod
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TranscriptionEngine(Enum):
    GOOGLE_WEB_SPEECH = "google_web_speech"
    VOSK = "vosk"
    WHISPER = "whisper"
    SPHINX = "sphinx"

class TranscriptionConfig:
    """Configuration for transcription services"""
    def __init__(self):
        # Read the environment variable, default to True if not set
        self.enable_whisper = os.getenv("ENABLE_WHISPER", "True").lower() in ("true", "1", "yes")
        self.preferred_engines = []
        if self.enable_whisper:
            self.preferred_engines.append(TranscriptionEngine.WHISPER)
        self.preferred_engines.extend([
            TranscriptionEngine.VOSK,
            TranscriptionEngine.GOOGLE_WEB_SPEECH,
        ])
        # self.preferred_engines = [
        #     TranscriptionEngine.VOSK,  # Offline, good balance
        #     TranscriptionEngine.WHISPER,  # High accuracy
        #     TranscriptionEngine.GOOGLE_WEB_SPEECH,  # Fallback
        # ]
        self.max_audio_length = 300  # 5 minutes
        self.sample_rate = 16000

class TranscriptionResult:
    """Standardized result format"""
    def __init__(self, text: str, engine: TranscriptionEngine, confidence: float = 1.0, success: bool = True):
        self.text = text
        self.engine = engine
        self.confidence = confidence
        self.success = success

class TranscriptionEngineInterface(ABC):
    """Interface for transcription engines"""
    
    @abstractmethod
    def transcribe(self, audio_path: str) -> TranscriptionResult:
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        pass

class GoogleWebSpeechEngine(TranscriptionEngineInterface):
    def __init__(self):
        self.recognizer = sr.Recognizer()
    
    def is_available(self) -> bool:
        return True  # Always available
    
    def transcribe(self, audio_path: str) -> TranscriptionResult:
        try:
            with sr.AudioFile(audio_path) as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                audio_data = self.recognizer.record(source)
                text = self.recognizer.recognize_google(audio_data)
                return TranscriptionResult(text, TranscriptionEngine.GOOGLE_WEB_SPEECH)
        except sr.UnknownValueError:
            return TranscriptionResult("", TranscriptionEngine.GOOGLE_WEB_SPEECH, success=True)
        except Exception as e:
            logger.error(f"Google Web Speech error: {e}")
            raise

class VoskEngine(TranscriptionEngineInterface):
    def __init__(self):
        self.model_path = None
        self._model = None
        self._initialize_vosk()
    
    def _initialize_vosk(self):
        """Initialize Vosk with a lightweight model"""
        try:
            from vosk import Model, KaldiRecognizer
            # Download model to ./models/vosk-model-small-en-us-0.15 if not exists
            model_path = "./models/vosk-model-small-en-us-0.15"
            if not os.path.exists(model_path):
                logger.warning("Vosk model not found. Please download from https://alphacephei.com/vosk/models")
                return
            self._model = Model(model_path)
            self.model_path = model_path
        except ImportError:
            logger.warning("Vosk not installed. Run: pip install vosk")
        except Exception as e:
            logger.error(f"Vosk initialization error: {e}")
    
    def is_available(self) -> bool:
        return self._model is not None
    
    def transcribe(self, audio_path: str) -> TranscriptionResult:
        if not self.is_available():
            raise RuntimeError("Vosk engine not available")
        
        try:
            import wave
            from vosk import KaldiRecognizer
            
            with wave.open(audio_path, "rb") as wf:
                # Check audio format
                if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
                    raise ValueError("Audio file must be WAV format mono PCM")
                
                recognizer = KaldiRecognizer(self._model, wf.getframerate())
                recognizer.SetWords(True)
                
                results = []
                while True:
                    data = wf.readframes(4000)
                    if len(data) == 0:
                        break
                    if recognizer.AcceptWaveform(data):
                        result = json.loads(recognizer.Result())
                        results.append(result.get("text", ""))
                
                # Get final result
                final_result = json.loads(recognizer.FinalResult())
                results.append(final_result.get("text", ""))
                
                text = " ".join(filter(None, results)).strip()
                return TranscriptionResult(text, TranscriptionEngine.VOSK)
                
        except Exception as e:
            logger.error(f"Vosk transcription error: {e}")
            raise

class WhisperEngine(TranscriptionEngineInterface):
    def __init__(self):
        self._model = None
        self._initialize_whisper()
    
    def _initialize_whisper(self):
        """Initialize Whisper with a small model for low resource usage"""
        try:
            import whisper
            # Use tiny or base model for low resource usage
            self._model = whisper.load_model("base")
        except ImportError:
            logger.warning("Whisper not installed. Run: pip install openai-whisper")
        except Exception as e:
            logger.error(f"Whisper initialization error: {e}")
    
    def is_available(self) -> bool:
        return self._model is not None
    
    def transcribe(self, audio_path: str) -> TranscriptionResult:
        if not self.is_available():
            raise RuntimeError("Whisper engine not available")
        
        try:
            result = self._model.transcribe(audio_path)
            text = result["text"].strip()
            return TranscriptionResult(text, TranscriptionEngine.WHISPER)
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            raise

class SphinxEngine(TranscriptionEngineInterface):
    def __init__(self):
        self.recognizer = sr.Recognizer()
    
    def is_available(self) -> bool:
        return True  # Always available with speech_recognition
    
    def transcribe(self, audio_path: str) -> TranscriptionResult:
        try:
            with sr.AudioFile(audio_path) as source:
                audio_data = self.recognizer.record(source)
                text = self.recognizer.recognize_sphinx(audio_data)
                return TranscriptionResult(text, TranscriptionEngine.SPHINX)
        except sr.UnknownValueError:
            return TranscriptionResult("", TranscriptionEngine.SPHINX, success=True)
        except Exception as e:
            logger.error(f"Sphinx transcription error: {e}")
            raise

class TranscriptionService:
    """Orchestrates multiple transcription engines with fallback"""
    
    def __init__(self, config: TranscriptionConfig):
        self.config = config
        self.engines = {
            TranscriptionEngine.GOOGLE_WEB_SPEECH: GoogleWebSpeechEngine(),
            TranscriptionEngine.VOSK: VoskEngine(),
            TranscriptionEngine.WHISPER: WhisperEngine(),
            TranscriptionEngine.SPHINX: SphinxEngine(),
        }
    
    def transcribe_audio(self, audio_path: str, preferred_engine: Optional[TranscriptionEngine] = None) -> Dict[str, Any]:
        """Transcribe audio using available engines with fallback"""
        
        engines_to_try = [preferred_engine] if preferred_engine else self.config.preferred_engines
        
        for engine_type in engines_to_try:
            engine = self.engines.get(engine_type)
            if engine and engine.is_available():
                try:
                    logger.info(f"Attempting transcription with {engine_type.value}")
                    result = engine.transcribe(audio_path)
                    
                    if result.text and len(result.text.strip()) > 0:
                        return {
                            "success": True,
                            "text": result.text,
                            "engine": result.engine.value,
                            "message": f"Transcription completed successfully using {result.engine.value}"
                        }
                    else:
                        logger.info(f"{engine_type.value} returned empty transcription")
                        
                except Exception as e:
                    logger.warning(f"{engine_type.value} failed: {e}")
                    continue
        
        # All engines failed or returned empty results
        return {
            "success": False,
            "text": "",
            "engine": "none",
            "message": "All transcription engines failed or returned empty results"
        }

# FastAPI Application
app = FastAPI(title="Enhanced Audio Transcription API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global services
config = TranscriptionConfig()
transcription_service = TranscriptionService(config)

def convert_to_wav(input_path: str, output_path: str = None) -> str:
    """Convert any audio format to WAV for speech recognition"""
    if output_path is None:
        output_path = tempfile.mktemp(suffix='.wav')
    
    audio = AudioSegment.from_file(input_path)
    audio = audio.set_frame_rate(16000).set_channels(1)
    audio.export(output_path, format="wav")
    return output_path

def cleanup_files(*file_paths):
    """Clean up temporary files"""
    for file_path in file_paths:
        if file_path and os.path.exists(file_path):
            try:
                os.unlink(file_path)
            except Exception as e:
                logger.warning(f"Failed to delete {file_path}: {e}")

@app.get("/")
async def health_check():
    return {"status": "healthy", "message": "Enhanced Audio Transcription API is running"}

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    engine: Optional[TranscriptionEngine] = None
):
    """
    Transcribe audio file to text with multiple engine support
    """
    input_path = None
    wav_path = None
    
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

        # Convert to WAV format
        wav_path = convert_to_wav(input_path)
        
        # Transcribe using the service
        result = transcription_service.transcribe_audio(wav_path, engine)
        result.update({
            "file_name": file.filename,
            "file_type": file.content_type
        })
        
        return result
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Transcription failed: {str(e)}"
        )
    finally:
        cleanup_files(input_path, wav_path)

@app.get("/engines/status")
async def get_engine_status():
    status = {}
    for engine_type, engine in transcription_service.engines.items():
        # For Whisper, also report if it was disabled by the feature flag
        if engine_type == TranscriptionEngine.WHISPER and not config.enable_whisper:
            status[engine_type.value] = {
                "available": False,
                "description": "Manually disabled via ENABLE_WHISPER environment variable"
            }
        else:
            status[engine_type.value] = {
                "available": engine.is_available(),
                "description": engine_type.name
            }
    return status

@app.get("/health")
async def detailed_health_check():
    """Detailed health check"""
    engine_status = await get_engine_status()
    return {
        "status": "healthy",
        "supported_formats": ["MP3", "WAV", "WebM", "OGG", "M4A", "MP4", "FLAC"],
        "engines": engine_status,
        "note": "FFmpeg required for non-WAV formats"
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )