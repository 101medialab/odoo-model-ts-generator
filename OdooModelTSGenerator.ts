import * as fs from "fs";
import { Model } from "./class/Model";
import { Field } from "./class/Field";

const odooModelRefToPascalCaseCache: {
    [key: string]: {
        moduleName: string,
        modelName: string,
        path: string,
        fileName: string,
        fullPath: string,
    }
} = {};

export class OdooModelTSGenerator {
    // language = TypeScript
    static modelClassTemplate: string = `import { BaseModel } from "../../client/BaseModel";

%import_statements%
%type_statements%
%model_description%
export class %class_name% extends BaseModel<%class_name%> {
    static modelName = '%model_name%';

%fields%
}
`;

    static camelize(input) {
        return input
            .replace(/\s(.)/g, function ($1) {
                return $1.toUpperCase();
            })
            .replace(/\s/g, '')
            .replace(/^(.)/, function ($1) {
                return $1.toLowerCase();
            });
    }

    static pascalize(input) {
        return this.capitalize(this.camelize(input.replace(/_/g, ' ')))
    }

    static capitalize(input) {
        return input[0].toUpperCase() + input.slice(1);
    }

    static getTSModuleAndModelName(odooModelName: string) {
        if (false === (odooModelName in odooModelRefToPascalCaseCache)) {
            let [module, modelName] = odooModelName.split(/\.(.+)?/, 2);

            const path = '/' + module + '/';

            odooModelRefToPascalCaseCache[odooModelName] = {
                moduleName: module,
                modelName: this.pascalize(odooModelName.replace(/\.|_/g, ' ')),
                path,
                fileName: modelName,
                fullPath: path + modelName
            };
        }

        return odooModelRefToPascalCaseCache[odooModelName];
    }

    static generate(models: Model[], destination: string) {
        let modelNameToFilePathMapContent = 'export const modelNameToFilePathMap = {\n';

        models.forEach(model => {
            const { modelName, path, fullPath } = this.getTSModuleAndModelName(model.model);

            const importStatementMap = new Map();
            const typeStatementMap = new Map();
            const fieldStatementMap = new Map();

            model.fields.forEach(field => {
                const {
                    importStatements,
                    typeStatements,
                    fieldStatement
                } = this.handleField(model, field);

                for (let key in importStatements) {
                    importStatementMap.set(key, importStatements[key]);
                }

                for (let key in typeStatements) {
                    typeStatementMap.set(key, typeStatements[key]);
                }

                fieldStatementMap.set(field.name, fieldStatement);
            });

            let modelDescription = '';
            if (model.info) {
                modelDescription += this.formatStringDocument(model.info);
                modelDescription = '/**' + modelDescription + '\n */';
            }

            if (!fs.existsSync(destination + path)) {
                fs.mkdirSync(destination + path, { recursive: true });
            }

            const { fileContent } = {
                fileContent: this.modelClassTemplate.replace(/%class_name%/g, modelName)
                    .replace(/%import_statements%/g, Array.from(importStatementMap.values()).join('\n') || '')
                    .replace(/%model_description%/g, modelDescription || '')
                    .replace(/%type_statements%/g, Array.from(typeStatementMap.values()).join('\n') || '')
                    .replace(/%model_name%/g, model.model)
                    .replace(/%fields%/g, Array.from(fieldStatementMap.values()).join('\n\n') || '')
            };

            if (!fs.existsSync(destination + path)) {
                fs.mkdirSync(destination + path, { recursive: true });
            }

            fs.writeFileSync(destination + fullPath + '.ts', fileContent);

            modelNameToFilePathMapContent += '    \'' + model.model + '\': { \n' +
                ' '.repeat(8) + 'filePath: \'' + fullPath.substr(1) + '\',\n' +
                ' '.repeat(8) + 'className: \'' + modelName + '\'\n' +
                '    },\n';
        });

        modelNameToFilePathMapContent += '\n};'

        fs.writeFileSync(destination + '/modelNameToFilePathMap.ts', modelNameToFilePathMapContent);
    }

    static formatStringDocument(text: string, spaceIndentation: string = '') {
        return '\n' + spaceIndentation + ' * ' + text.trim().replace(/\n/g, '\n' + spaceIndentation + ' * ');
    }

    static handleField(model: Model, field: Field) {
        if (field.selections) {
            this.generateSelectionType(field);
        }

        const importStatements = {};

        const typeStatements = {};

        let fieldStatement = '';
        let fieldType = '';

        const indentation = ' '.repeat(4);
        if (field.help) {
            fieldStatement = indentation + '/**' + this.formatStringDocument(field.help, indentation) + '\n' + indentation + ' */\n';
        }

        if (['many2many', 'one2many', 'many2one'].indexOf(field.ttype) > -1) {
            importStatements['ModelReference'] = 'import { ModelReference } from "../../client/ModelReference";';

            if (field.ttype !== 'many2one') {
                importStatements['ReferenceQuantityMode'] = 'import { ReferenceQuantityMode } from "../../client/ModelReference";';
                importStatements['TToMany'] = 'import { TToMany } from "../../client/Domains";';
            } else {
                importStatements['TToOne'] = 'import { TToOne } from "../../client/Domains";';
            }

            const relatedFieldModuleAndModelName = this.getTSModuleAndModelName(field.relation);
            if (field.relation !== model.model) {
                const currentFieldModuleAndModelName = this.getTSModuleAndModelName(model.model);

                if (relatedFieldModuleAndModelName.moduleName === currentFieldModuleAndModelName.moduleName) {
                    importStatements[field.relation] = 'import { ' + relatedFieldModuleAndModelName.modelName + ' } from "./' + relatedFieldModuleAndModelName.fileName + '";';
                } else {
                    importStatements[field.relation] = 'import { ' + relatedFieldModuleAndModelName.modelName + ' } from "..' + relatedFieldModuleAndModelName.fullPath + '";';
                }
            }

            fieldStatement += indentation + '@ModelReference(\'' + field.relation + '\'' + (field.ttype !== 'many2one' ? ', ReferenceQuantityMode.MULTI' : '') + ')\n';

            fieldType = 'T' + (field.ttype !== 'many2one' ? 'ToMany' : 'ToOne') + '<' + relatedFieldModuleAndModelName.modelName + '>';
        } else if (field.ttype === 'selection') {
            const { typeName, typeDefinition } = this.generateSelectionType(field);

            if (typeName !== 'any') {
                typeStatements[typeName] = typeDefinition;

                fieldType = 'T' + typeName;
            }

            fieldType = typeName;
        } else {
            fieldType = this.resolveFieldType(field);
        }

        fieldStatement += indentation + field.name + (field.required === false ? '?' : '') + ': ' + fieldType + ';';

        return { importStatements, typeStatements, fieldStatement };
    }

    static resolveFieldType(field: Field) {
        switch (field.ttype) {
            // TODO: Double check
            case 'many2one_reference':
                return 'number';

            // TODO: Double check
            case 'reference':
                return 'number';

            // TODO: Double check
            case 'datetime':
                return 'Date | string';

            case 'text':
                return 'string';

            // TODO: Double check
            case 'monetary':
                return 'number';

            case 'float':
                return 'number';

            // TODO: Double check
            case 'binary':
                return 'string';

            case 'char':
                return 'string';

            case 'date':
                return 'Date | string';

            // TODO: Double check
            case 'html':
                return 'string';

            case 'boolean':
                return 'boolean';

            case 'integer':
                return 'number';
        }
    }

    static generateSelectionType(field: Field) {
        const typeName = 'T' + this.pascalize(field.name);

        if (field.selections === null) {
            return {
                typeName: 'any',
                typeDefinition: ''
            }
        }

        return {
            typeName,
            typeDefinition: `export const ${ typeName } = {
${ field.selections.map(each => `    '${ each.value }': '${ each.value }'`).join(',\n') }
} as const;
export type ${ typeName } = typeof ${ typeName }[keyof typeof ${ typeName }];\n`
        };
    }
}
