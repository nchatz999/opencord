import type { Component } from 'solid-js'
import { createMemo, Show } from 'solid-js'
import { Wifi } from 'lucide-solid'

const ConnectionIndicator: Component = () => {
    const statusConfig = createMemo(() => {
        return {
            color: 'text-status-online',
            icon: Wifi,
            label: 'Connected',
            pulseColor: 'bg-status-online',
            showPulse: false,
        }
    })

    return (
        <div class="flex items-center gap-2 text-sm">
            <div class="relative">
                {(() => {
                    const Icon = statusConfig().icon
                    return <Icon size={16} class={statusConfig().color} />
                })()}
                <Show when={statusConfig().showPulse}>
                    <div
                        class={`absolute -inset-1 rounded-full ${statusConfig().pulseColor} opacity-25 animate-ping`}
                    />
                </Show>
            </div>
            <span class={statusConfig().color}>{statusConfig().label}</span>
        </div>
    )
}

export default ConnectionIndicator
