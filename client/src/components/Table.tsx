import { mergeProps, type Component, type JSX } from "solid-js";
import { cn } from "../utils";

interface TableProps extends JSX.HTMLAttributes<HTMLTableElement> {
  children: JSX.Element;
}

export const Table: Component<TableProps> = (props) => {
  const merged = mergeProps(props);
  let tableRef: HTMLDivElement | undefined;

  return (
    <div ref={tableRef} class="overflow-auto max-h-[calc(60vh-200px)]">
      <table class={cn("w-full border-collapse", merged.class)} {...merged}>
        {merged.children}
      </table>
    </div>
  );
};

export const TableHead: Component<
  JSX.HTMLAttributes<HTMLTableSectionElement>
> = (props) => {
  const merged = mergeProps(props);

  return (
    <thead class={cn("bg-[#2f3136]", merged.class)} {...merged}>
      {merged.children}
    </thead>
  );
};

export const TableBody: Component<
  JSX.HTMLAttributes<HTMLTableSectionElement>
> = (props) => {
  const merged = mergeProps(props);

  return (
    <tbody
      class={cn("bg-[#36393f] divide-y divide-[#2f3136]", merged.class)}
      {...merged}
    >
      {merged.children}
    </tbody>
  );
};

export const TableRow: Component<JSX.HTMLAttributes<HTMLTableRowElement>> = (
  props
) => {
  const merged = mergeProps(props);

  return (
    <tr class={cn("border-b border-[#2f3136]", merged.class)} {...merged}>
      {merged.children}
    </tr>
  );
};

export const TableHeader: Component<
  JSX.ThHTMLAttributes<HTMLTableHeaderCellElement>
> = (props) => {
  const merged = mergeProps(props);

  return (
    <th
      class={cn(
        "py-3 px-6 text-left text-xs text-[#dcddde] font-medium uppercase tracking-wider sticky top-0 z-10 bg-[#2f3136]",
        "first:left-0 first:z-20 first:bg-[#202225]",
        merged.class
      )}
      {...merged}
    >
      {merged.children}
    </th>
  );
};

export const TableCell: Component<
  JSX.TdHTMLAttributes<HTMLTableDataCellElement>
> = (props) => {
  const merged = mergeProps(props);

  return (
    <td
      class={cn(
        "px-6 py-4 whitespace-nowrap text-sm text-[#dcddde]",
        "first:sticky first:left-0 first:z-10 first:bg-[#2f3136] first:font-medium",
        merged.class
      )}
      {...merged}
    >
      {merged.children}
    </td>
  );
};
