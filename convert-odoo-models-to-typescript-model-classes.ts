import { Client } from 'pg';
import { Model } from "./class/Model";
import { OdooModelTSGenerator } from "./OdooModelTSGenerator";
import { odooDatabaseConfig } from "../../odoo-config-settings";

export const sql = `SELECT
    json_agg(
        im2.*
    )
FROM (
    SELECT
        im.id,
        im.name,
        im.model,
        im.info,
        im.transient,
        fields.field_json AS fields
    FROM ir_model im
    JOIN (
        SELECT
            model_id,
            json_agg(fields.* ORDER BY fields.id) AS field_json
        FROM (
            SELECT
                imf.id,
                imf.model_id,
                imf.name,
                imf.relation,
                imf.field_description,
                imf.help,
                imf.ttype,
                imf.required,
                selections.selection AS selections
            FROM (
                SELECT
                    imf.*
                FROM ir_model_fields imf
            ) imf
            LEFT JOIN (
                SELECT
                    imf.id                                       AS imf_id,
                    json_agg(json_build_object('name', imfs.name, 'value', value) ORDER BY imfs.id) AS selection
                FROM ir_model_fields           imf
                JOIN ir_model_fields_selection imfs ON imf.id = imfs.field_id
                GROUP BY imf.id
            ) selections ON imf.id = selections.imf_id
        ) fields
        GROUP BY fields.model_id
    )             fields ON im.id = fields.model_id
) im2
GROUP BY im2.id`;

const client = new Client(odooDatabaseConfig);

client.connect();
client.query(sql, (err, res) => {
    if (err !== null) {
        console.log(err);

        return;
    }

    const odooModels: Model[] = res.rows.map((each) => each.json_agg[0]);

    OdooModelTSGenerator.generate(odooModels, './lib/OdooJSONRPC/OdooModels');

    client.end()
});

