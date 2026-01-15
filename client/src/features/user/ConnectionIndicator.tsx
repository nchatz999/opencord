import type { Component } from 'solid-js'
import { Show, Switch, Match } from 'solid-js'
import { Wifi, Loader } from 'lucide-solid'
import { useLiveKit } from '../../lib/livekit'

const ConnectionIndicator: Component = () => {
    const [livekitState] = useLiveKit()

    return (
        <Show when={livekitState.connectionState}>
            <div class="flex items-center gap-2 text-sm">
                <Switch>
                    <Match when={livekitState.connectionState === 'connecting'}>
                        <Loader size={16} class="text-presence-away animate-spin" />
                        <span class="text-presence-away">Connecting</span>
                    </Match>
                    <Match when={livekitState.connectionState === 'connected'}>
                        <Wifi size={16} class="text-presence-online" />
                        <span class="text-presence-online">Connected</span>
                    </Match>
                </Switch>
            </div>
        </Show>
    )
}

export default ConnectionIndicator
