import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.ComponentProps<"table">
>(function Table({ className, ...props }, ref) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        ref={ref}
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
})

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentProps<"thead">
>(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
})

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentProps<"tbody">
>(function TableBody({ className, ...props }, ref) {
  return (
    <tbody
      ref={ref}
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
})

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.ComponentProps<"tfoot">
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      data-slot="table-footer"
      data-ui-text="emphasis"
      className={cn(
        "border-t bg-muted/50 [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
})

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.ComponentProps<"tr">
>(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
})

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ComponentProps<"th">
>(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      data-slot="table-head"
      data-ui-text="emphasis"
      className={cn(
        "h-10 px-2 text-left align-middle whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
})

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.ComponentProps<"td">
>(function TableCell({ className, ...props }, ref) {
  return (
    <td
      ref={ref}
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
})

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.ComponentProps<"caption">
>(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
})

Table.displayName = "Table"
TableHeader.displayName = "TableHeader"
TableBody.displayName = "TableBody"
TableFooter.displayName = "TableFooter"
TableRow.displayName = "TableRow"
TableHead.displayName = "TableHead"
TableCell.displayName = "TableCell"
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
