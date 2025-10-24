"use client";
import { useEffect, useRef, useState } from "react";

export default function VoicePage() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [audioURL, setAudioURL] = useState(null);
  const [duration, setDuration] = useState(0);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [playing, setPlaying] = useState(false);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]); // local chunk storage
  const audioRef = useRef(null);
  const blobRef = useRef(null); // keep reference to last recorded blob
  const maxDuration = 5 * 60; // 5 minutes

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

  // --- Start Recording ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        "audio/mpeg",
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
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
    a.currentTime = 0; // ensure restart
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

  // --- Upload recorded blob to /api/upload ---
  const uploadRecording = async () => {
    if (!blobRef.current) {
      alert("No recording available to upload!");
      return;
    }
    const fileName = generateDateFilename(".mp3");
    const file = new File([blobRef.current], fileName, { type: blobRef.current.type });

    const formData = new FormData();
    formData.append("file", file, fileName);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        alert(`Uploaded successfully!\nURL: ${data.fileUrl}`);
        setUploadedFileName(fileName);
      } else {
        alert("Upload failed: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert("Failed to upload recording.");
    }
  };

  // --- Upload manually selected mp3 ---
  const handleMp3Upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert("File too large. Max 10MB allowed.");
      return;
    }
    const ext = file.name.includes(".")
      ? file.name.substring(file.name.lastIndexOf("."))
      : ".mp3";
    const newName = generateDateFilename(ext);
    const url = URL.createObjectURL(file);
    if (audioURL) URL.revokeObjectURL(audioURL);
    setAudioURL(url);
    setUploadedFileName(newName);
    setDuration(0);

    const formData = new FormData();
    formData.append("file", file, newName);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) alert(`Uploaded file successfully!\nURL: ${data.fileUrl}`);
      else alert("Upload failed: " + (data.error || "Unknown error"));
    } catch (err) {
      alert("Failed to upload file.");
    }
  };

  return (
    <main className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[42rem] bg-gradient-to-br from-gray-800 via-gray-900 to-black/80 p-6 rounded-2xl shadow-2xl ring-1 ring-white/5">
        <header className="flex items-center gap-4 mb-4">
          <div className="h-12 w-12 rounded-full bg-gradient-to-b from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none">
              <path d="M12 1v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold">Voice Recorder</h1>
            <p className="text-xs text-gray-400">
              Record, pause, play and upload your audio (max 5 minutes)
            </p>
          </div>
        </header>

        <section className="bg-gray-800 p-4 rounded-xl shadow-inner">
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
              disabled={!blobRef.current} onClick={uploadRecording}>⬆️ Upload</button>
            <button className="py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition disabled:opacity-50"
              disabled={!blobRef.current} onClick={downloadRecording}>💾 Save</button>
          </div>

          <div className="mt-4">
            <audio ref={audioRef} src={audioURL || undefined} controls
              className="w-full rounded-md bg-black/20"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            {uploadedFileName && (
              <div className="mt-2 text-xs text-gray-400">
                Last uploaded filename: {uploadedFileName}
              </div>
            )}
          </div>

          {/* Upload existing MP3 */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex-1">
              <input type="file" accept="audio/*" onChange={handleMp3Upload}
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700" />
            </label>
            <div className="text-sm text-gray-400">Or upload an existing MP3</div>
          </div>

          {!recorderSupported && (
            <div className="mt-3 text-xs text-yellow-300">
              Browser doesn’t support recording. Try Chrome / Edge / Firefox.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
