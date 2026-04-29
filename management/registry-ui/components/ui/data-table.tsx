import React, { useEffect, useState } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender,
  type ColumnDef, type SortingState, type VisibilityState, type RowSelectionState,
  type TableOptions,
} from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Settings2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 20;

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  loading?: boolean;
  emptyMessage?: string;
  emptyFilteredMessage?: string;

  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  enableSelection?: boolean;
  onSelectionChange?: (rows: TData[]) => void;

  pageSize?: number;
  storageKey?: string;

  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;

  toolbar?: React.ReactNode;
  batchActions?: React.ReactNode;

  columnLabels?: Record<string, string>;

  defaultSorting?: SortingState;
  defaultVisibility?: VisibilityState;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data.',
  emptyFilteredMessage,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  enableSelection = false,
  onSelectionChange,
  pageSize = DEFAULT_PAGE_SIZE,
  storageKey,
  getRowId,
  onRowClick,
  toolbar,
  batchActions,
  columnLabels,
  defaultSorting = [],
  defaultVisibility,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Restore visibility from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`dt_vis_${storageKey}`);
      if (raw) {
        setColumnVisibility(JSON.parse(raw));
        return;
      }
    } catch {}
    if (defaultVisibility) setColumnVisibility(defaultVisibility);
  }, [storageKey, defaultVisibility]);

  // Persist visibility
  useEffect(() => {
    if (!storageKey || Object.keys(columnVisibility).length === 0) return;
    try { localStorage.setItem(`dt_vis_${storageKey}`, JSON.stringify(columnVisibility)); } catch {}
  }, [storageKey, columnVisibility]);

  // Inject select column if enabled
  const allColumns = React.useMemo(() => {
    if (!enableSelection) return columns;
    const selectCol: ColumnDef<TData, any> = {
      id: '__select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };
    return [selectCol, ...columns];
  }, [columns, enableSelection]);

  const tableOptions: TableOptions<TData> = {
    data,
    columns: allColumns,
    state: { sorting, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    enableRowSelection: enableSelection,
    ...(getRowId ? { getRowId } : {}),
  };

  const table = useReactTable(tableOptions);

  // Notify parent of selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    const selected = table.getSelectedRowModel().rows.map(r => r.original);
    onSelectionChange(selected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const selectedCount = Object.keys(rowSelection).length;
  const colCount = table.getVisibleLeafColumns().length;

  // Build toggleable columns list (exclude __select and actions)
  const toggleableColumns = table.getAllColumns().filter(
    col => col.getCanHide() && col.id !== '__select'
  );

  return (
    <div className="space-y-4">
      {/* Toolbar row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        {onSearchChange && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        )}

        {toolbar}

        {/* Column visibility */}
        {toggleableColumns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 ml-auto">
                <Settings2 className="h-4 w-4 mr-1.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px] max-h-[400px] overflow-y-auto">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {columnLabels?.[col.id] ?? col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Batch actions bar */}
      {selectedCount > 0 && batchActions && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2.5 animate-fade-in">
          <Badge variant="outline" className="font-medium">
            {selectedCount} selected
          </Badge>
          <div className="flex gap-2 ml-auto">
            {batchActions}
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        className={canSort ? 'cursor-pointer select-none' : ''}
                      >
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> :
                            sorted === 'desc' ? <ArrowDown className="h-3.5 w-3.5 text-primary" /> :
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-16 text-muted-foreground">
                    {(searchValue?.trim() ? emptyFilteredMessage : null) ?? emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className={onRowClick ? 'cursor-pointer' : ''}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isInteractive = cell.column.id === '__select' || cell.column.id === 'actions';
                      return (
                        <TableCell
                          key={cell.id}
                          onClick={isInteractive ? (e) => e.stopPropagation() : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {data.length} rows
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8"
              onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8"
              onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 font-medium">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8"
              onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
