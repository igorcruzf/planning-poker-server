import { z } from 'zod';
import {
    JIRA_ASSIGNEE_MAX_LENGTH,
    JIRA_DESCRIPTION_HTML_MAX_LENGTH,
    JIRA_ISSUE_KEY_MAX_LENGTH,
    JIRA_ISSUE_TYPE_MAX_LENGTH,
    JIRA_SIZE_FIELD_ID_MAX_LENGTH,
    JIRA_SIZE_FIELD_NAME,
    JIRA_SIZE_MAX_LENGTH,
    JIRA_SIZE_OPTION_MAX_LENGTH,
    JIRA_STATUS_MAX_LENGTH,
    JIRA_SUMMARY_MAX_LENGTH,
    JiraIssue,
    JiraIssueSummary,
    JiraSizeField,
} from '../../contracts';

const namedSchema = z.object({ name: z.string() });

const allowedValueSchema = z.object({
    id: z.string(),
    value: z.string().optional(),
    name: z.string().optional(),
});

const editmetaFieldSchema = z.object({
    name: z.string(),
    allowedValues: z.array(allowedValueSchema).optional(),
});

export const editmetaSchema = z.object({ fields: z.record(z.string(), editmetaFieldSchema) });
export type Editmeta = z.infer<typeof editmetaSchema>;

export const fieldListSchema = z.array(z.object({ id: z.string(), name: z.string() }));

const rawIssueSchema = z.object({
    key: z.string(),
    fields: z.looseObject({
        summary: z.string().nullish(),
        issuetype: namedSchema,
        status: namedSchema,
        assignee: z.object({ displayName: z.string() }).nullish(),
    }),
    renderedFields: z.object({ description: z.string().nullish() }).nullish(),
    editmeta: editmetaSchema.optional(),
});
type RawIssue = z.infer<typeof rawIssueSchema>;

export const searchResponseSchema = z.object({ issues: z.array(rawIssueSchema) });
export const issueResponseSchema = rawIssueSchema;

const clip = (text: string, maxLength: number): string => text.slice(0, maxLength);

const withoutCutTag = (html: string): string => {
    const lastOpening = html.lastIndexOf('<');
    return lastOpening > html.lastIndexOf('>') ? html.slice(0, lastOpening) : html;
};

const clipHtml = (html: string): string =>
    html.length <= JIRA_DESCRIPTION_HTML_MAX_LENGTH
        ? html
        : withoutCutTag(html.slice(0, JIRA_DESCRIPTION_HTML_MAX_LENGTH));

const sizeValueOf = (raw: unknown): string | null => {
    const value = typeof raw === 'object' && raw !== null ? (raw as { value?: unknown }).value : raw;
    return typeof value === 'string' && value.length > 0 ? clip(value, JIRA_SIZE_MAX_LENGTH) : null;
};

export const issueUrl = (siteUrl: string, key: string): string => `${siteUrl.replace(/\/+$/, '')}/browse/${key}`;

export const sizeFieldFromEditmeta = (editmeta: Editmeta | undefined): JiraSizeField | null => {
    const entry = Object.entries(editmeta?.fields ?? {}).find(([, field]) => field.name === JIRA_SIZE_FIELD_NAME);
    if (!entry) {
        return null;
    }
    const [fieldId, field] = entry;
    return {
        fieldId: clip(fieldId, JIRA_SIZE_FIELD_ID_MAX_LENGTH),
        options: (field.allowedValues ?? []).flatMap((option) => {
            const value = option.value ?? option.name;
            return value === undefined
                ? []
                : [{ id: clip(option.id, JIRA_SIZE_OPTION_MAX_LENGTH), value: clip(value, JIRA_SIZE_OPTION_MAX_LENGTH) }];
        }),
    };
};

export const toIssueSummary = (raw: RawIssue, siteUrl: string, sizeFieldId: string | null): JiraIssueSummary => ({
    key: clip(raw.key, JIRA_ISSUE_KEY_MAX_LENGTH),
    summary: clip(raw.fields.summary ?? '', JIRA_SUMMARY_MAX_LENGTH),
    issueType: clip(raw.fields.issuetype.name, JIRA_ISSUE_TYPE_MAX_LENGTH),
    status: clip(raw.fields.status.name, JIRA_STATUS_MAX_LENGTH),
    size: sizeFieldId ? sizeValueOf(raw.fields[sizeFieldId]) : null,
    url: issueUrl(siteUrl, raw.key),
});

export const toIssue = (raw: RawIssue, siteUrl: string): JiraIssue => {
    const sizeField = sizeFieldFromEditmeta(raw.editmeta);
    const description = raw.renderedFields?.description;
    return {
        ...toIssueSummary(raw, siteUrl, sizeField?.fieldId ?? null),
        assignee: raw.fields.assignee ? clip(raw.fields.assignee.displayName, JIRA_ASSIGNEE_MAX_LENGTH) : null,
        descriptionHtml: description ? clipHtml(description) : null,
        sizeField,
    };
};
