// Type stubs for UI dependencies with incomplete or missing TypeScript definitions
// These declarations use `any` where precise types are unknown to keep the build green.

declare module 'react-day-picker' {
  import * as React from 'react';
  export const DayPicker: React.FC<any>;
  export function getDefaultClassNames(): Record<string, string>;
  export type DayButton = any;
  export type CalendarProps = Record<string, any>;
  declare const _default: { DayPicker: typeof DayPicker; getDefaultClassNames: typeof getDefaultClassNames; };
  export default _default;
}

declare module 'embla-carousel-react' {
  import * as React from 'react';
  export function useEmblaCarousel(): [React.RefObject<HTMLDivElement>, { scrollPrev: () => void; scrollNext: () => void }];
  export default function EmblaCarousel(props: any): React.ReactElement;
}

declare module 'recharts' {
  import * as React from 'react';
  export const BarChart: React.FC<any>;
  export const LineChart: React.FC<any>;
  export const XAxis: React.FC<any>;
  export const YAxis: React.FC<any>;
  export const Tooltip: React.FC<any>;
  export const Bar: React.FC<any>;
  export const CartesianGrid: React.FC<any>;
  export const Legend: React.FC<any>;
  export const ResponsiveContainer: React.FC<any>;
  export type TooltipProps = any;
  export type LegendProps = any;
}

declare module 'cmdk' {
  import * as React from 'react';
  interface CommandProps { children?: React.ReactNode; [key: string]: any; }
  interface CommandItemProps { children?: React.ReactNode; onSelect?: () => void; [key: string]: any; }
  const Command: React.FC<CommandProps> & {
    Input: React.FC<any>;
    List: React.FC<{ children: React.ReactNode }>;
    Item: React.FC<CommandItemProps>;
    Empty: React.FC<{ children: React.ReactNode }>;
    Group: React.FC<{ children: React.ReactNode; heading?: React.ReactNode }>;
    Separator: React.FC<any>;
  };
  export { Command };
}

declare module 'vaul' {
  import * as React from 'react';
  interface DrawerProps { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode; [key: string]: any; }
  interface DrawerContentProps { children: React.ReactNode; [key: string]: any; }
  const Drawer: React.FC<DrawerProps> & {
    Content: React.FC<DrawerContentProps>;
    Trigger: React.FC<{ children: React.ReactNode; asChild?: boolean }>;
    Close: React.FC<any>;
    Header: React.FC<{ children: React.ReactNode }>;
    Footer: React.FC<{ children: React.ReactNode }>;
    Title: React.FC<{ children: React.ReactNode }>;
    Description: React.FC<{ children: React.ReactNode }>;
  };
  export { Drawer };
}

declare module 'input-otp' {
  import * as React from 'react';
  interface OTPInputProps { maxLength?: number; onChange?: (value: string) => void; [key: string]: any; }
  const OTPInput: React.FC<OTPInputProps> & {
    slots: { root: React.FC<any>; input: React.FC<any> };
  };
  export { OTPInput };
}

declare module 'react-resizable-panels' {
  import * as React from 'react';
  export const Panel: React.FC<any>;
  export const PanelGroup: React.FC<any>;
  export const PanelResizeHandle: React.FC<any>;
}
