# ProfitBot MCP Email Functionality - OpenClaw Prompt

You now have access to comprehensive email functionality through the ProfitBot MCP server. You can send emails, manage email templates, and read email history.

## Available Email Tools

### 1. Send Emails

**Tool: `send_email`**
- Send emails directly to contacts in conversations
- Automatically stores emails in the contact history for tracking
- Parameters:
  - `subject` (required): Email subject line
  - `body` (required): Email body content (supports plain text, will be formatted as HTML)
  - `conversationId` (optional): The conversation ID - if provided, email is sent to the contact in that conversation
  - `contactId` (optional): The contact ID - if provided, email is sent directly to that contact
  - **Note**: You must provide either `conversationId` OR `contactId` (at least one is required)

**Example Usage:**
```
Use send_email to send a follow-up email to the contact in conversation abc-123:
- conversationId: "abc-123"
- subject: "Thank you for your inquiry"
- body: "Hi! We received your message and will get back to you within 24 hours."
```

### 2. Email Templates

**List Templates: `list_email_templates`**
- Get all email templates available for this workspace
- Returns: Array of templates with `id`, `name`, `subject`, `body`, `created_at`, `updated_at`

**Get Template: `get_email_template`**
- Retrieve a specific template by ID
- Parameters: `templateId` (required)

**Create Template: `create_email_template`**
- Create a new reusable email template
- Parameters:
  - `name` (required): Template name (e.g., "Welcome Email", "Follow-up")
  - `subject` (optional): Default subject line
  - `body` (optional): Default email body

**Update Template: `update_email_template`**
- Modify an existing template
- Parameters:
  - `templateId` (required)
  - `name` (optional): New template name
  - `subject` (optional): New subject
  - `body` (optional): New body

**Delete Template: `delete_email_template`**
- Remove a template
- Parameters: `templateId` (required)

**Example Workflow:**
```
1. First, list all templates: list_email_templates
2. If you need a new template, create it: create_email_template with name="Follow-up", subject="Checking in", body="Hi {{name}}, just following up..."
3. When sending emails, you can reference templates or use them as starting points
```

### 3. Read Emails

**List Emails: `list_emails`**
- View email history for a contact or conversation
- Supports pagination
- Parameters:
  - `contactId` (optional): Filter by contact ID
  - `conversationId` (optional): Filter by conversation ID
  - `limit` (optional): Number of emails per page (default: 50, max: 100)
  - `page` (optional): Page number (default: 1)
  - **Note**: Provide either `contactId` OR `conversationId`

**Get Email: `get_email`**
- Retrieve details of a specific email
- Parameters: `emailId` (required)
- Returns: Full email details including subject, body_preview, status, direction (inbound/outbound), timestamps

**Example Usage:**
```
To see all emails in a conversation:
- Use list_emails with conversationId="abc-123"
- This shows both inbound (received) and outbound (sent) emails
- Check the "direction" field to distinguish between sent and received emails
```

## Common Use Cases

### Use Case 1: Send Follow-up Email After Conversation
```
1. Get conversation details: get_conversation with conversationId
2. Send email: send_email with conversationId, subject, and body
```

### Use Case 2: Create and Use Email Templates
```
1. Create template: create_email_template with name="Welcome", subject="Welcome!", body="Hi {{name}}, welcome to our service!"
2. List templates: list_email_templates to see all available templates
3. Get template: get_email_template with templateId to retrieve template details
4. Use template content when sending: send_email (you can use template's subject/body as starting point)
```

### Use Case 3: Review Email History
```
1. List emails for a conversation: list_emails with conversationId
2. Review the email history to understand communication timeline
3. Get specific email details: get_email with emailId if you need full details
```

## Important Notes

1. **Workspace Scoping**: All email operations are automatically scoped to your workspace. You can only access emails and templates for your workspace.

2. **Email Templates**: Templates are user-scoped (created by the MCP API key's user). They are reusable across your workspace.

3. **Email Storage**: All sent emails are automatically stored in `contact_emails` table and linked to the contact and conversation. This enables:
   - Unified view of chat + email in the Messages dashboard
   - Email tracking (status, delivery, opens)
   - Email history per contact

4. **Email Provider**: Emails are sent via Resend (configured in ProfitBot Settings → Integrations). Make sure Resend is connected for email sending to work.

5. **Contact Email**: The system automatically extracts the primary email from the contact's email field. If a contact has no email, the send operation will fail with an error.

6. **Email Formatting**: Email bodies are automatically formatted as HTML. Plain text line breaks are converted to `<br>` tags. Links are automatically made clickable.

## Integration with Other Tools

You can combine email functionality with other ProfitBot tools:

- **With Conversations**: Use `get_conversation` to get conversation details, then `send_email` with the `conversationId`
- **With Contacts**: Use `get_contact` to get contact details, then `send_email` with the `contactId`
- **With Leads**: Use `get_lead` to get lead details, find the associated contact, then send emails
- **With Messages**: Review conversation messages with `get_conversation_messages`, then send follow-up emails

## Error Handling

- If email sending fails, check:
  - Contact has a valid email address
  - Resend integration is configured in ProfitBot Settings
  - The conversation/contact belongs to your workspace
- If template operations fail, verify:
  - Template ID exists (use `list_email_templates` to see available templates)
  - You have permission to access the template (it belongs to your workspace)

## Best Practices

1. **Always verify contact/conversation exists** before sending emails
2. **Use templates** for frequently sent emails to maintain consistency
3. **Review email history** before sending to avoid duplicate communications
4. **Personalize emails** by including contact name or conversation context
5. **Check email status** after sending to confirm delivery

You now have full email capabilities! Use these tools to communicate with contacts, manage email templates, and track email history within ProfitBot.
