import { createSignal, Show, type Component } from "solid-js";
import { Play } from "lucide-solid";
import { getHttpUrl } from "../lib/ServerConfig";
import { getSessionToken } from "../utils";
import Button from "./Button";

interface VideoPreviewProps {
    src: string;
}

const VideoPreview: Component<VideoPreviewProps> = (props) => {
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
        <div class="bg-bg-elevated rounded-lg overflow-hidden border border-border-base max-w-sm">
            <Show
                when={url()}
                fallback={
                    <div class="flex items-center justify-center w-64 h-36 bg-bg-subtle">
                        <Button variant="ghost" onClick={load}>
                            <Play size={32} />
                        </Button>
                    </div>
                }
            >
                <video src={url()} controls autoplay class="w-full max-h-96" />
            </Show>
        </div>
    );
};

export default VideoPreview;
