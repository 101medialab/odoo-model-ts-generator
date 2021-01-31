import { Selection } from "./Selection";

export interface Field {
    id: number;
    model_id: number;
    name: string;
    field_description: string;
    ttype: string;
    selections?: Selection[];
    relation?: string;
    help?: string;
    required?: boolean;
}
