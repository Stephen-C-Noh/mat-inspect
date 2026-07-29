'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  checklistItemTypeSchema,
  failSeveritySchema,
  type ChecklistItem,
} from '@mat-inspect/shared-schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
};

const BLANK_ITEM: ChecklistItem = {
  key: '',
  prompt: '',
  type: 'BOOLEAN',
  required: true,
  failSeverity: 'BLOCKING',
};

// The item's own `key` field is user-edited text (it can collide or change mid-edit), so it
// can't double as React's list key. This id exists only to keep row identity stable across
// add/remove/reorder; it carries no business meaning and is never sent to the server.
const useRowIds = (items: ChecklistItem[]): string[] => {
  const [ids, setIds] = useState<string[]>(() => items.map(() => crypto.randomUUID()));

  useEffect(() => {
    if (ids.length !== items.length) {
      setIds(items.map((_, i) => ids[i] ?? crypto.randomUUID()));
    }
    // Only re-sync on a length change (items replaced wholesale by the parent); per-field
    // edits keep the same array length and must not regenerate row identity.
  }, [items, ids]);

  return ids;
};

export const ChecklistItemFormBuilder = ({ items, onChange }: Props): ReactElement => {
  const ids = useRowIds(items);

  const updateItem = (index: number, patch: Partial<ChecklistItem>): void => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addItem = (): void => {
    onChange([...items, { ...BLANK_ITEM }]);
  };

  const removeItem = (index: number): void => {
    onChange(items.filter((_, i) => i !== index));
  };

  const moveItem = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => (
        <div key={ids[index]} className="rounded-sm border border-border bg-card p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">Item {index + 1}</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move item up"
                disabled={index === 0}
                onClick={() => moveItem(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move item down"
                disabled={index === items.length - 1}
                onClick={() => moveItem(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove item"
                disabled={items.length <= 1}
                onClick={() => removeItem(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-key-${ids[index]}`}>Key</Label>
              <Input
                id={`item-key-${ids[index]}`}
                value={item.key}
                onChange={(e) => updateItem(index, { key: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-prompt-${ids[index]}`}>Prompt</Label>
              <Input
                id={`item-prompt-${ids[index]}`}
                value={item.prompt}
                onChange={(e) => updateItem(index, { prompt: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-type-${ids[index]}`}>Type</Label>
              <Select
                value={item.type}
                onValueChange={(value) =>
                  updateItem(index, { type: value as ChecklistItem['type'] })
                }
              >
                <SelectTrigger id={`item-type-${ids[index]}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {checklistItemTypeSchema.options.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-severity-${ids[index]}`}>Fail severity</Label>
              <Select
                value={item.failSeverity}
                onValueChange={(value) =>
                  updateItem(index, { failSeverity: value as ChecklistItem['failSeverity'] })
                }
              >
                <SelectTrigger id={`item-severity-${ids[index]}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {failSeveritySchema.options.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {severity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`item-reg-ref-${ids[index]}`}>Regulatory reference (optional)</Label>
              <Input
                id={`item-reg-ref-${ids[index]}`}
                value={item.regulatoryReference ?? ''}
                onChange={(e) =>
                  updateItem(index, {
                    // The schema is .min(1).optional(): an empty string must become undefined,
                    // not '', or validation rejects it.
                    regulatoryReference: e.target.value === '' ? undefined : e.target.value,
                  })
                }
              />
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id={`item-required-${ids[index]}`}
                checked={item.required}
                onCheckedChange={(checked) => updateItem(index, { required: checked === true })}
              />
              <Label htmlFor={`item-required-${ids[index]}`}>Required</Label>
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={addItem} className="self-start">
        <Plus className="size-4" />
        Add item
      </Button>
    </div>
  );
};
