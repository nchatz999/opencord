import type { Component } from 'solid-js'
import { Show, For } from 'solid-js'
import { ChevronDown, ChevronRight, Phone } from 'lucide-solid'
import { useAuth, useUser, useVoip, usePreference } from '../../store/index'
import { useLiveKit } from '../../lib/livekit'
import Avatar from '../../components/Avatar'
import { useToaster } from '../../components/Toaster'

const COLLAPSED_KEY = 'incomingCallsCollapsed'

const IncomingCallsPanel: Component = () => {
    const [, prefActions] = usePreference()
    const [, authActions] = useAuth()
    const [, userActions] = useUser()
    const [voipState, voipActions] = useVoip()
    const [, livekitActions] = useLiveKit()
    const { addToast } = useToaster()

    const isCollapsed = () => prefActions.get<boolean>(COLLAPSED_KEY) ?? false

    const toggleCollapsed = () => {
        prefActions.set(COLLAPSED_KEY, !isCollapsed())
    }

    const currentUserId = () => authActions.getUser().userId
    const myCallRecipient = () => voipActions.findById(currentUserId())?.recipientId

    const incomingCallers = () => {
        return voipState.voipState
            .filter(p => p.recipientId === currentUserId() && p.userId !== myCallRecipient())
            .map(p => ({ participant: p, user: userActions.findById(p.userId) }))
            .filter(c => c.user !== undefined)
    }

    const handleCallback = async (callerId: number) => {
        const result = await voipActions.joinPrivate(callerId, livekitActions.getMuted(), livekitActions.getDeafened())

        if (result.isErr()) {
            addToast(`Failed to join call: ${result.error}`, 'error')
        }
    }

    return (
        <Show when={incomingCallers().length > 0}>
            <div class="bg-bg-subtle border-t border-border-base">
                <button
                    onClick={toggleCollapsed}
                    class="w-full px-3 py-2 flex items-center gap-2 hover:bg-bg-overlay transition-colors"
                >
                    <Show when={isCollapsed()} fallback={<ChevronDown size={14} class="text-fg-subtle" />}>
                        <ChevronRight size={14} class="text-fg-subtle" />
                    </Show>
                    <span class="text-xs font-medium text-fg-base">
                        Incoming Calls ({incomingCallers().length})
                    </span>
                </button>

                <Show when={!isCollapsed()}>
                    <div class="max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                        <For each={incomingCallers()}>
                            {(caller) => (
                                <div class="px-3 py-1.5 flex items-center gap-2 hover:bg-bg-overlay transition-colors group">
                                    <Avatar
                                        avatarFileId={caller.user!.avatarFileId}
                                        alt={caller.user!.username}
                                        size="xs"
                                    />
                                    <span class="flex-1 text-sm text-fg-base truncate">
                                        {caller.user!.username}
                                    </span>
                                    <button
                                        onClick={() => handleCallback(caller.user!.userId)}
                                        class="p-1 rounded hover:bg-status-success/20 transition-colors"
                                        title="Answer Call"
                                    >
                                        <Phone size={14} class="text-status-success" />
                                    </button>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </Show>
    )
}

export default IncomingCallsPanel
