import { Field } from "./Field";

export interface Model {
    id: number;
    name: string;
    model: string;
    info: string;
    fields: Field[];
    transient?: boolean;
}
