import type { Component } from "solid-js";
import logo from "../assets/opencord.webp";

const Loading: Component = () => {
    return (
        <div class="fixed inset-0 bg-background flex items-center justify-center">
            <div class="flex flex-col items-center gap-4">
                <div class="relative">
                    <img
                        src={logo}
                        alt="Loading..."
                        class="w-16 h-16 animate-spin"
                        style={{
                            "animation-duration": "2s",
                            "animation-timing-function": "linear",
                            "animation-iteration-count": "infinite"
                        }}
                    />
                </div>
                <div class="text-secondary-text text-sm font-medium">
                    Loading...
                </div>
            </div>
        </div>
    );
};

export default Loading;
