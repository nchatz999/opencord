import { createSignal, Show, type Component } from "solid-js";
import { Play } from "lucide-solid";
import { getHttpUrl } from "../lib/ServerConfig";
import { getSessionToken } from "../utils";
import Button from "./Button";

interface SoundPreviewProps {
    src: string;
    fileName: string;
}

const SoundPreview: Component<SoundPreviewProps> = (props) => {
    const [url, setUrl] = createSignal<string>();

    const load = async () => {
        const token = getSessionToken();
        if (!token) return;

        const res = await fetch(`${getHttpUrl()}${props.src}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            setUrl(URL.createObjectURL(await res.blob()));
        }
    };

    return (
        <div class="bg-bg-elevated rounded-lg border border-border-base p-3 max-w-xs">
            <div class="text-fg-base text-sm mb-2 truncate">{props.fileName}</div>
            <Show
                when={url()}
                fallback={
                    <Button variant="ghost" size="sm" onClick={load}>
                        <Play size={16} class="mr-1" />
                        Play
                    </Button>
                }
            >
                <audio src={url()} controls autoplay class="w-full" />
            </Show>
        </div>
    );
};

export default SoundPreview;
