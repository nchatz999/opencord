import type { Component, JSX } from "solid-js";

interface Props {
    name: string;
    children: JSX.Element;
    onClick: () => void;
}

const Role: Component<Props> = (props) => {
    return (
        <div
            class="flex flex-col gap-2 hover:bg-muted pl-4 py-2"
            onClick={() => {
                props.onClick();
            }}
        >
            <div class="text-dis-gray">{props.name}</div>
            <div class="pl-4 pt-2 flex flex-col gap-5 max-h-70 overflow-auto">
                {props.children}
            </div>
        </div>
    );
};

export default Role;
