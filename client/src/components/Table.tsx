import { splitProps, type Component, type JSX } from "solid-js";
import { cn } from "../utils";

type Align = "left" | "center" | "right";

const alignClasses: Record<Align, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

interface TableProps extends JSX.HTMLAttributes<HTMLTableElement> {
  children: JSX.Element;
}

export const Table: Component<TableProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <div class="overflow-auto max-h-[calc(60vh-200px)]">
      <table class={cn("w-full border-collapse", local.class)} {...rest}>
        {local.children}
      </table>
    </div>
  );
};

export const TableHead: Component<JSX.HTMLAttributes<HTMLTableSectionElement>> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <thead class={cn("bg-card", local.class)} {...rest}>
      {local.children}
    </thead>
  );
};

export const TableBody: Component<JSX.HTMLAttributes<HTMLTableSectionElement>> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <tbody class={cn("bg-popover divide-y divide-border-subtle", local.class)} {...rest}>
      {local.children}
    </tbody>
  );
};

export const TableRow: Component<JSX.HTMLAttributes<HTMLTableRowElement>> = (props) => {
  const [local, rest] = splitProps(props, ["class", "children"]);

  return (
    <tr class={cn("border-b border-border-subtle", local.class)} {...rest}>
      {local.children}
    </tr>
  );
};

interface TableHeaderProps extends JSX.ThHTMLAttributes<HTMLTableHeaderCellElement> {
  align?: Align;
}

export const TableHeader: Component<TableHeaderProps> = (props) => {
  const [local, rest] = splitProps(props, ["align", "class", "children"]);

  return (
    <th
      class={cn(
        "py-3 px-6 sticky top-0 z-10 bg-card",
        "first:left-0 first:z-20 first:bg-input",
        local.class
      )}
      {...rest}
    >
      <div class={cn("flex items-center", alignClasses[local.align ?? "left"])}>
        <span class="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          {local.children}
        </span>
      </div>
    </th>
  );
};

interface TableCellProps extends JSX.TdHTMLAttributes<HTMLTableDataCellElement> {
  align?: Align;
}

export const TableCell: Component<TableCellProps> = (props) => {
  const [local, rest] = splitProps(props, ["align", "class", "children"]);

  return (
    <td
      class={cn(
        "px-6 py-4 whitespace-nowrap",
        "first:sticky first:left-0 first:z-10 first:bg-popover",
        local.class
      )}
      {...rest}
    >
      <div class={cn("flex items-center", alignClasses[local.align ?? "left"])}>
        <span class="text-sm text-foreground">
          {local.children}
        </span>
      </div>
    </td>
  );
};
