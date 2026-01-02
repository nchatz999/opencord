import type { Component } from "solid-js";
import type { File } from "../../model";
import { useFile } from "../../store/index";
import Image from "../../components/Image";

interface FileProps {
  file: File;
}

const FileItem: Component<FileProps> = (props) => {
  const [, fileActions] = useFile();

  const handleDownload = async (e: MouseEvent) => {
    e.preventDefault();
    const result = await fileActions.downloadFile(props.file.fileId);

    if (result.isErr()) return;

    const blob = new Blob([result.value], { type: props.file.fileType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = props.file.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {props.file.fileType.startsWith("image/") ? (
        <Image
          class="rounded-lg max-w-sm max-h-96 object-contain"
          src={`/message/files/${props.file.fileId}`}
          alt="File preview"
          expandable
        />
      ) : (
        <div class="bg-sidebar p-4 mt-2 rounded-xl">
          <div class="flex flex-row gap-3">
            <svg
              fill="none"
              height="40"
              viewBox="0 0 72 96"
              width="30"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="m72 29.3v60.3c0 2.24 0 3.36-.44 4.22-.38.74-1 1.36-1.74 1.74-.86.44-1.98.44-4.22.44h-59.2c-2.24 0-3.36 0-4.22-.44-.74-.38-1.36-1-1.74-1.74-.44-.86-.44-1.98-.44-4.22v-83.2c0-2.24 0-3.36.44-4.22.38-.74 1-1.36 1.74-1.74.86-.44 1.98-.44 4.22-.44h36.3c1.96 0 2.94 0 3.86.22.5.12.98.28 1.44.5v16.88c0 2.24 0 3.36.44 4.22.38.74 1 1.36 1.74 1.74.86.44 1.98.44 4.22.44h16.88c.22.46.38.94.5 1.44.22.92.22 1.9.22 3.86z"
                fill="#d3d6fd"
              />
              <path
                d="m68.26 20.26c1.38 1.38 2.06 2.06 2.56 2.88.18.28.32.56.46.86h-16.88c-2.24 0-3.36 0-4.22-.44-.74-.38-1.36-1-1.74-1.74-.44-.86-.44-1.98-.44-4.22v-16.880029c.3.14.58.28.86.459999.82.5 1.5 1.18 2.88 2.56z"
                fill="#939bf9"
              />
            </svg>
            <div class="flex flex-col">
              <a href="#" onClick={handleDownload} class="text-link cursor-pointer">
                {props.file.fileName}
              </a>
              <div class="text-sm text-muted-foreground-dark">
                {props.file.fileSize} bytes
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileItem;
