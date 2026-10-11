import { type MarshalNode } from "../backend/file/rpgmaker-rgss/marshal";
export const ruby_symbol = (value: string): MarshalNode => ({ t: ":", data: Buffer.from(value) });
export const ruby_string = (value: string): MarshalNode => ({
  t: "I",
  child: { t: '"', data: Buffer.from(value) },
  pairs: [[ruby_symbol("E"), { t: "T" }]],
});
export const ruby_array = (items: MarshalNode[]): MarshalNode => ({ t: "[", items });
export const ruby_integer = (value: number): MarshalNode => ({ t: "i", value });
export const ruby_object = (klass: string, fields: Record<string, MarshalNode>): MarshalNode => ({
  t: "o",
  klass: ruby_symbol(klass),
  pairs: Object.entries(fields).map(([key, value]) => [ruby_symbol(key), value]),
});
export const ruby_command = (code: number, parameters: MarshalNode[], indent = 0): MarshalNode =>
  ruby_object("RPG::EventCommand", {
    "@code": ruby_integer(code),
    "@indent": ruby_integer(indent),
    "@parameters": ruby_array(parameters),
  });
