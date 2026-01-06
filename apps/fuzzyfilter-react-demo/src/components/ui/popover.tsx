/**
 * Popover Component
 *
 * A floating panel that displays information on hover or click.
 * Built on top of @base-ui/react for accessibility and positioning.
 */

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

/**
 * Root component for Popover
 */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * Trigger element that opens the popover
 */
function PopoverTrigger({
  className,
  ...props
}: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      className={cn(
        "inline-flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
        className
      )}
      {...props}
    />
  );
}

/**
 * Popover content container
 */
function PopoverContent({
  className,
  sideOffset = 8,
  align = "center",
  side = "top",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "sideOffset" | "align" | "side" | "alignOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={sideOffset}
        align={align}
        side={side}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
            "bg-popover text-popover-foreground border border-border rounded-lg shadow-lg",
            "p-3 min-w-[200px] max-w-[320px] origin-[var(--transform-origin)]",
            "transition-all duration-150 ease-out",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

/**
 * Popover arrow element
 */
function PopoverArrow({ className, ...props }: PopoverPrimitive.Arrow.Props) {
  return (
    <PopoverPrimitive.Arrow
      data-slot="popover-arrow"
      className={cn("fill-popover drop-shadow-sm", className)}
      {...props}
    >
      <svg width="14" height="7" viewBox="0 0 14 7" fill="none">
        <path
          d="M6.76437 1.10207L2.80758 4.47318C2.07308 5.13423 1.11989 5.5 0.13172 5.5H0V7H14V5.5H13.8683C12.8801 5.5 11.9269 5.13423 11.1924 4.47318L7.23563 1.10207C6.8553 0.7598 6.27797 0.75979 6.76437 1.10207Z"
          className="fill-popover"
        />
        <path
          d="M6.76437 1.10207L2.80758 4.47318C2.07308 5.13423 1.11989 5.5 0.13172 5.5H0V5H0.13172C1.11989 5 2.07308 4.63423 2.80758 3.97318L6.76437 0.60207C7.14468 0.2598 7.72199 0.25979 8.10232 0.60207L12.059 3.97318C12.7935 4.63423 13.7467 5 14.7349 5H14V5.5H13.8683C12.8801 5.5 11.9269 5.13423 11.1924 4.47318L7.23563 1.10207C6.8553 0.7598 6.27797 0.75979 6.76437 1.10207Z"
          className="fill-border"
        />
      </svg>
    </PopoverPrimitive.Arrow>
  );
}

/**
 * Popover title element
 */
function PopoverTitle({
  className,
  ...props
}: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-semibold text-sm mb-1", className)}
      {...props}
    />
  );
}

/**
 * Popover description element
 */
function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
};

