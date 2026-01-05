/**
 * Select Component - shadcn-vue style wrapper for Radix Vue Select
 * 
 * Provides properly styled Select components that fix:
 * - Selected value display
 * - Positioning issues  
 * - Accessibility concerns
 */
import { h, defineComponent, type PropType } from "vue";
import {
  SelectRoot,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
  SelectContent as SelectContentPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator as SelectItemIndicatorPrimitive,
  SelectPortal,
} from "radix-vue";
import { CheckIcon, ChevronDownIcon } from "lucide-vue-next";
import { cn } from "@/lib/utils";

/**
 * Select Root Component
 */
export const Select = SelectRoot;

/**
 * Select Trigger Component
 */
export const SelectTrigger = defineComponent({
  name: "SelectTrigger",
  inheritAttrs: false,
  props: {
    class: String,
    disabled: Boolean,
  },
  setup(props, { slots, attrs }) {
    return () => {
      return h(
        SelectTriggerPrimitive,
        {
          ...attrs,
          class: cn(
            "border-input data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] w-fit h-9 flex items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50",
            props.class
          ),
          disabled: props.disabled,
        },
        {
          default: () => [
            slots.default?.(),
            h(ChevronDownIcon, {
              class: "text-muted-foreground size-4 pointer-events-none shrink-0",
            }),
          ],
        }
      );
    };
  },
});

/**
 * Select Value Component
 */
export const SelectValue = defineComponent({
  name: "SelectValue",
  inheritAttrs: false,
  props: {
    placeholder: String,
    class: String,
  },
  setup(props, { slots, attrs }) {
    return () => {
      return h(
        SelectValuePrimitive,
        {
          ...attrs,
          placeholder: props.placeholder,
          class: cn("flex flex-1 text-left", props.class),
        },
        slots
      );
    };
  },
});

/**
 * Select Content Component
 */
export const SelectContent = defineComponent({
  name: "SelectContent",
  inheritAttrs: false,
  props: {
    position: {
      type: String as PropType<"item-aligned" | "popper">,
      default: "popper",
    },
    side: {
      type: String as PropType<"top" | "right" | "bottom" | "left">,
      default: "bottom",
    },
    align: {
      type: String as PropType<"start" | "center" | "end">,
      default: "start",
    },
    sideOffset: {
      type: Number,
      default: 4,
    },
    alignOffset: {
      type: Number,
      default: 0,
    },
    class: String,
  },
  setup(props, { slots, attrs }) {
    return () => {
      return h(SelectPortal, {}, {
        default: () => h(
          SelectContentPrimitive,
          {
            ...attrs,
            position: props.position,
            side: props.side,
            align: props.align,
            sideOffset: props.sideOffset,
            alignOffset: props.alignOffset,
            class: cn(
              "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 min-w-36 rounded-md shadow-md ring-1 duration-100 relative isolate z-50 max-h-[--radix-select-content-available-height] origin-[--radix-select-content-transform-origin] overflow-x-hidden overflow-y-auto",
              props.class
            ),
          },
          {
            default: () => slots.default?.(),
          }
        ),
      });
    };
  },
});

/**
 * Select Item Component
 */
export const SelectItem = defineComponent({
  name: "SelectItem",
  inheritAttrs: false,
  props: {
    value: {
      type: String,
      required: true,
    },
    disabled: Boolean,
    class: String,
    text: String,
  },
  setup(props, { slots, attrs }) {
    return () => {
      return h(
        SelectItemPrimitive,
        {
          ...attrs,
          value: props.value,
          disabled: props.disabled,
          class: cn(
            "focus:bg-accent focus:text-accent-foreground gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm relative flex w-full cursor-default items-center outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            props.class
          ),
        },
        {
          default: () => [
            h("span", {
              class: "flex flex-1 gap-2 shrink-0 whitespace-nowrap",
            }, slots.default?.()),
            h(SelectItemIndicatorPrimitive, {
              class: "pointer-events-none absolute right-2 flex size-4 items-center justify-center",
            }, {
              default: () => h(CheckIcon, {
                class: "pointer-events-none size-4",
              }),
            }),
          ],
        }
      );
    };
  },
});
