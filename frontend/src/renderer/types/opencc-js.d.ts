declare module "opencc-js" {
  export type ConverterOptions = {
    from?: "cn" | "tw" | "twp" | "hk" | "jp" | "t";
    to?: "cn" | "tw" | "twp" | "hk" | "jp" | "t";
  };

  export function Converter(options?: ConverterOptions): (text: string) => string;
}
