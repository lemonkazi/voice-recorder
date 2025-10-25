"use client";
import { useEffect, useRef, useState } from "react";

export default function VoicePage() {
  // Existing states
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [audioURL, setAudioURL] = useState(null);
  const [duration, setDuration] = useState(0);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [playing, setPlaying] = useState(false);
  
  // New states for transcription
  const [transcription, setTranscription] = useState(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);
  const blobRef = useRef(null);
  const fileInputRef = useRef(null);
  const maxDuration = 5 * 60;

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  useEffect(() => {
    return () => {
      if (streamRef.current)
        streamRef.current.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioURL) URL.revokeObjectURL(audioURL);
    };
  }, [audioURL]);

  // Reset transcription when new recording starts
  useEffect(() => {
    if (isRecording) {
      setTranscription(null);
      setTranscriptionError(null);
    }
  }, [isRecording]);

  // --- Drag and Drop Handlers ---
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('audio/')) {
        handleFileUpload(file);
      } else {
        setTranscriptionError("Please drop an audio file (MP3, WAV, etc.)");
      }
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    
    const maxBytes = 25 * 1024 * 1024; // Increased to 25MB
    if (file.size > maxBytes) {
      alert("File too large. Max 25MB allowed.");
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);
    setTranscription(null);

    const ext = file.name.includes(".")
      ? file.name.substring(file.name.lastIndexOf("."))
      : ".mp3";
    const newName = generateDateFilename(ext);
    const url = URL.createObjectURL(file);
    
    if (audioURL) URL.revokeObjectURL(audioURL);
    setAudioURL(url);
    setUploadedFileName(file.name); // Keep original filename
    setDuration(0);

    const formData = new FormData();
    formData.append("file", file, newName);
    
    try {
      const res = await fetch("/api/upload", { 
        method: "POST", 
        body: formData 
      });
      
      const data = await res.json();
      
      if (data.success) {
        setTranscription(data);
      } else {
        setTranscriptionError(data.error || "Transcription failed");
        alert("Upload failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Upload error:", err);
      setTranscriptionError("Failed to connect to transcription service");
      alert("Failed to upload file.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // --- Recording functions ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/wav",
        "audio/ogg;codecs=opus",
        "audio/mpeg"
      ];

      let selectedType = preferredTypes.find((t) =>
        MediaRecorder.isTypeSupported?.(t)
      );
      const options = selectedType ? { mimeType: selectedType } : undefined;

      const mr = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || "audio/webm",
        });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        if (audioURL) URL.revokeObjectURL(audioURL);
        setAudioURL(url);
        setIsRecording(false);
        setIsPaused(false);
        clearInterval(timerRef.current);
      };

      mr.start();
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          if (next >= maxDuration) stopRecording();
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied or error", err);
      setRecorderSupported(false);
    }
  };

  const pauseRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      mr.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "paused") {
      mr.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          if (next >= maxDuration) stopRecording();
          return next;
        });
      }, 1000);
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && (mr.state === "recording" || mr.state === "paused")) {
      mr.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const playAudio = () => {
    if (!audioURL) return;
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play();
    setPlaying(true);
    a.onended = () => setPlaying(false);
  };

  const pauseAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    setPlaying(false);
  };

  const generateDateFilename = (ext = ".mp3") => {
    const now = new Date();
    const iso = now.toISOString().replace(/[:.]/g, "-");
    return `${iso}${ext}`;
  };

  const downloadRecording = () => {
    if (!blobRef.current) return;
    const filename = generateDateFilename(".mp3");
    const blobUrl = URL.createObjectURL(blobRef.current);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  // --- Upload recorded audio ---
  const uploadRecording = async () => {
    if (!blobRef.current) {
      alert("No recording available to upload!");
      return;
    }

    setIsTranscribing(true);
    setTranscriptionError(null);
    setTranscription(null);
    
    const fileName = generateDateFilename(".mp3");
    const file = new File([blobRef.current], fileName, { type: blobRef.current.type });

    const formData = new FormData();
    formData.append("file", file, fileName);

    try {
      const res = await fetch("/api/upload", { 
        method: "POST", 
        body: formData 
      });
      
      const data = await res.json();
      
      if (data.success) {
        setTranscription(data);
        setUploadedFileName(fileName);
      } else {
        setTranscriptionError(data.error || "Transcription failed");
        alert("Transcription failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Upload error:", err);
      setTranscriptionError("Failed to connect to transcription service");
      alert("Failed to upload recording.");
    } finally {
      setIsTranscribing(false);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  // Clear current audio and transcription
  const clearAll = () => {
    if (audioURL) URL.revokeObjectURL(audioURL);
    setAudioURL(null);
    setUploadedFileName(null);
    setTranscription(null);
    setTranscriptionError(null);
    setDuration(0);
    blobRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <main className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[42rem] bg-gradient-to-br from-gray-800 via-gray-900 to-black/80 p-6 rounded-2xl shadow-2xl ring-1 ring-white/5">
        <header className="flex items-center gap-4 mb-6">
          <div className="h-12 w-12 rounded-full bg-gradient-to-b from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none">
              <path d="M12 1v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Audio Transcription Studio</h1>
            <p className="text-xs text-gray-400">
              Record, upload, and transcribe audio to text (max 5 minutes recording, 25MB upload)
            </p>
          </div>
          {audioURL && (
            <button 
              onClick={clearAll}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Clear
            </button>
          )}
        </header>

        {/* Upload Section - Moved to Top */}
        <section className="mb-6">
          <div 
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              dragOver 
                ? 'border-blue-500 bg-blue-500/10' 
                : 'border-gray-600 bg-gray-800/50 hover:border-gray-500'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex flex-col items-center gap-3">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-200">
                  Drop your audio file here or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Supports MP3, WAV, WebM, OGG, M4A, MP4, FLAC (max 25MB)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileInputChange}
                disabled={isTranscribing}
                className="hidden"
                id="audio-upload"
              />
              <label 
                htmlFor="audio-upload"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium cursor-pointer transition disabled:opacity-50"
              >
                {isTranscribing ? "Processing..." : "Browse Files"}
              </label>
            </div>
          </div>
        </section>

        {/* Recording Section */}
        <section className="bg-gray-800 p-4 rounded-xl shadow-inner mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span>🎙️ Record Audio</span>
            <span className="text-xs text-gray-400 font-normal">(Max 5 minutes)</span>
          </h2>

          {/* Timer */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-mono">{formatTime(duration)}</div>
              <div className="text-sm text-gray-400">
                {isRecording ? (isPaused ? "Paused" : "Recording...") : audioURL ? "Ready" : "Idle"}
              </div>
            </div>
            <div className="text-xs text-gray-400">Limit: 05:00</div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
            <button className="py-2 px-3 rounded-lg bg-red-600 hover:bg-red-700 transition disabled:opacity-50"
              disabled={isRecording && !isPaused} onClick={startRecording}>🎙️ Start</button>
            <button className="py-2 px-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 transition disabled:opacity-50"
              disabled={!isRecording || isPaused} onClick={pauseRecording}>⏸ Pause</button>
            <button className="py-2 px-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 transition disabled:opacity-50"
              disabled={!isRecording || !isPaused} onClick={resumeRecording}>▶️ Resume</button>
            <button className="py-2 px-3 rounded-lg bg-gray-600 hover:bg-gray-700 transition"
              onClick={stopRecording}>⏹ Stop</button>
            <button className="py-2 px-3 rounded-lg bg-green-600 hover:bg-green-700 transition disabled:opacity-50"
              disabled={!audioURL} onClick={playAudio}>▶️ Play</button>
            <button className="py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50"
              disabled={!blobRef.current || isTranscribing} onClick={uploadRecording}>
              {isTranscribing ? "⏳..." : "📝 Transcribe"}
            </button>
            <button className="py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-50"
              disabled={!blobRef.current} onClick={downloadRecording}>💾 Save</button>
          </div>

          {/* Audio Player */}
          <div className="mt-4">
            <audio ref={audioRef} src={audioURL || undefined} controls
              className="w-full rounded-md bg-black/20"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            {uploadedFileName && (
              <div className="mt-2 text-xs text-gray-400 flex items-center gap-2">
                <span>Current file: {uploadedFileName}</span>
              </div>
            )}
          </div>

          {!recorderSupported && (
            <div className="mt-3 text-xs text-yellow-300">
              Browser doesn't support recording. Try Chrome / Edge / Firefox.
            </div>
          )}
        </section>

        {/* Transcription Results */}
        {(transcription || transcriptionError || isTranscribing) && (
          <section className="bg-gray-800 p-4 rounded-xl shadow-inner">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>📄 Transcription Results</span>
              {isTranscribing && (
                <span className="text-sm text-yellow-400 animate-pulse">Processing...</span>
              )}
            </h2>

            {isTranscribing && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-gray-700 rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                <div className="flex-1">
                  <span className="text-sm text-gray-300">Transcribing audio... This may take a moment.</span>
                  <div className="w-full bg-gray-600 rounded-full h-1.5 mt-2">
                    <div className="bg-blue-500 h-1.5 rounded-full animate-pulse"></div>
                  </div>
                </div>
              </div>
            )}

            {transcriptionError && (
              <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg mb-4">
                <div className="text-red-300 font-medium">Transcription Error</div>
                <div className="text-red-200 text-sm mt-1">{transcriptionError}</div>
                <button 
                  onClick={() => setTranscriptionError(null)}
                  className="mt-2 px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs transition"
                >
                  Dismiss
                </button>
              </div>
            )}

            {transcription && !isTranscribing && (
              <div className="space-y-4">
                {/* Main Transcription Text */}
                <div className="p-4 bg-gray-700 rounded-lg">
                  <div className="text-sm text-gray-400 mb-2 flex justify-between items-center">
                    <span>Transcribed Text:</span>
                    <button 
                      onClick={() => navigator.clipboard.writeText(transcription.text)}
                      className="text-xs bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded transition"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-gray-100 whitespace-pre-wrap bg-gray-800 p-3 rounded">
                    {transcription.text || "No text transcribed"}
                  </div>
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-700 p-3 rounded-lg">
                    <div className="text-gray-400">Recognition Engine</div>
                    <div className="text-gray-100 capitalize">{transcription.engine || "Unknown"}</div>
                  </div>
                  <div className="bg-gray-700 p-3 rounded-lg">
                    <div className="text-gray-400">File Type</div>
                    <div className="text-gray-100">{transcription.file_type || "Unknown"}</div>
                  </div>
                </div>

                {/* Timestamps (if available) */}
                {transcription.timestamps && transcription.timestamps.length > 0 && (
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <div className="text-sm text-gray-400 mb-2">Timestamps:</div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {transcription.timestamps.map((chunk, index) => (
                        <div key={index} className="flex justify-between items-center text-sm">
                          <span className="text-gray-300">
                            [{chunk.timestamp[0].toFixed(2)}s - {chunk.timestamp[1].toFixed(2)}s]
                          </span>
                          <span className="text-gray-100 flex-1 ml-4">{chunk.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}