// src/components/media/UploadModal.tsx
import { useState, useRef } from "react";
import { X, Upload, File, Image, Video, Music } from "lucide-react";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: (url: string, title: string, type: string, mimeType: string, fileSize: number, totalPages?: number) => void;
}

export default function UploadModal({ isOpen, onClose, onUploaded }: UploadModalProps) {
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFiles([...files, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFiles([...files, ...Array.from(e.target.files)]);
    }
  };

  const getIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <Image size={16} />;
    if (file.type.startsWith("video/")) return <Video size={16} />;
    if (file.type.startsWith("audio/")) return <Music size={16} />;
    return <File size={16} />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]); // Remove data URI prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);

    try {
      const results: Array<{ url: string; title: string; type: string; mimeType: string; fileSize: number; totalPages?: number }> = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(Math.round(((i + 1) / files.length) * 100));

        const base64Data = await readFileAsBase64(file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type,
            base64Data,
            fileSize: file.size,
          }),
        });

        if (!res.ok) throw new Error(`Upload failed for ${file.name}`);

        const data = await res.json();
        results.push({
          url: data.url,
          title: file.name,
          type: file.type.startsWith('audio/') ? 'AUDIO' :
                file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE',
          mimeType: file.type,
          fileSize: data.fileSize || file.size,
          totalPages: data.totalPages,
        });
      }

      // Notify parent of successful uploads
      if (results.length > 0 && onUploaded) {
        const r = results[0];
        onUploaded(r.url, r.title, r.type, r.mimeType, r.fileSize, r.totalPages);
      }

      setFiles([]);
      onClose();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Upload Files</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`mb-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragActive
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50"
          }`}
        >
          <Upload size={32} className="mb-2 text-muted-foreground" />
          <p className="mb-2 text-sm text-foreground">
            Drag & drop files here, or{" "}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-primary underline"
            >
              browse
            </button>
          </p>
          <p className="text-xs text-muted-foreground">
            Supports: Images, Videos, Audio files (max 50MB)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleChange}
            className="hidden"
          />
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mb-4 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background p-2"
              >
                {getIcon(file)}
                <div className="flex-1">
                  <p className="truncate text-sm text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <button
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  className="rounded-lg p-1 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Progress Bar */}
        {uploading && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Uploading...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={uploading || files.length === 0}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading..." : `Upload ${files.length} file${files.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}