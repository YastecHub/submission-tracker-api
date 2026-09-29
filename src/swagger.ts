import swaggerJsdoc from 'swagger-jsdoc';

const publicApiUrl = process.env.PUBLIC_API_URL ?? process.env.RENDER_EXTERNAL_URL;

const servers = publicApiUrl
  ? [{ url: publicApiUrl.replace(/\/$/, ''), description: 'Production' }]
  : process.env.NODE_ENV === 'production'
    ? [{ url: '/', description: 'Current deployment' }]
    : [{ url: `http://localhost:${process.env.PORT ?? 3001}`, description: 'Local development server' }];

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'NEXIUM API',
      version: '1.0.0',
      description:
        'NEXIUM — class submissions, payments, account transparency and Nexium Bulletin. ' +
        'Staff manage class workflows and durable announcements; verified student accounts access payments, tickets, transparency and published updates.',
    },
    servers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from POST /api/auth/login',
        },
        studentBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Student JWT obtained from POST /api/student-auth/login or registration verification',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        StudentAccount: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            matricNumber: { type: 'string' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
          },
        },
        StudentPushSubscription: {
          type: 'object',
          required: ['endpoint', 'keys'],
          properties: {
            endpoint: { type: 'string', format: 'uri', maxLength: 2048 },
            expirationTime: { type: 'number', nullable: true },
            keys: {
              type: 'object',
              required: ['p256dh', 'auth'],
              properties: {
                p256dh: { type: 'string' },
                auth: { type: 'string' },
              },
            },
          },
        },
        SubmissionEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string', example: 'aB3dE7f' },
            title: { type: 'string', example: 'Assignment 1' },
            courseCode: { type: 'string', example: 'CSC401' },
            type: { type: 'string', enum: ['assignment', 'attendance', 'lab', 'other'] },
            description: { type: 'string', nullable: true },
            deadline: { type: 'string', format: 'date-time' },
            isClosed: { type: 'boolean' },
            isDeleted: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            totalSubmissions: { type: 'integer' },
            confirmedCount: { type: 'integer' },
            pendingCount: { type: 'integer' },
          },
        },
        Submission: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
            fullName: { type: 'string', example: 'Amina Bello' },
            matricNumber: { type: 'string', example: '2021/12345' },
            level: {
              type: 'string',
              nullable: true,
              enum: ['100L', '200L', '300L', '400L', '500L', 'Postgrad', null],
            },
            qrCode: { type: 'string', description: 'Base64 PNG data URL' },
            submittedAt: { type: 'string', format: 'date-time' },
            isConfirmed: { type: 'boolean' },
            confirmedAt: { type: 'string', format: 'date-time', nullable: true },
            confirmedBy: { type: 'string', nullable: true },
          },
        },
        PaymentEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            amount: { type: 'string', example: '5000.00' },
            accountNumber: { type: 'string' },
            accountName: { type: 'string' },
            bankName: { type: 'string' },
            deadline: { type: 'string', format: 'date-time' },
            hasTickets: { type: 'boolean' },
            isClosed: { type: 'boolean' },
            isDeleted: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            totalReceipts: { type: 'integer' },
            confirmedCount: { type: 'integer' },
            rejectedCount: { type: 'integer' },
            pendingCount: { type: 'integer' },
          },
        },
        PaymentReceipt: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            eventId: { type: 'string', format: 'uuid' },
            fullName: { type: 'string' },
            matricNumber: { type: 'string' },
            level: { type: 'string', nullable: true },
            receiptUrl: { type: 'string', format: 'uri' },
            submittedAt: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'rejected'] },
            confirmedAt: { type: 'string', format: 'date-time', nullable: true },
            confirmedBy: { type: 'string', nullable: true },
            note: { type: 'string', nullable: true },
            extractedAmount: { type: 'string', nullable: true },
            amountCheckStatus: { type: 'string', enum: ['pending', 'matched', 'mismatch', 'unreadable', 'unavailable'] },
            ticketQrCode: { type: 'string', nullable: true },
            isClaimed: { type: 'boolean' },
            claimedAt: { type: 'string', format: 'date-time', nullable: true },
            claimedBy: { type: 'string', nullable: true },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['credit', 'debit'] },
            amount: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', nullable: true },
            occurredAt: { type: 'string', format: 'date-time' },
            proofUrl: { type: 'string', nullable: true },
            recorderName: { type: 'string', nullable: true },
            recorderRole: { type: 'string', nullable: true },
            receiptId: { type: 'string', format: 'uuid', nullable: true },
            isDeleted: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AnnouncementSection: {
          type: 'object',
          required: ['id', 'body'],
          properties: {
            id: { type: 'string' },
            heading: { type: 'string', nullable: true, maxLength: 120 },
            body: { type: 'string', maxLength: 10000 },
          },
        },
        AnnouncementMedia: {
          type: 'object',
          required: ['id', 'url', 'thumbnailUrl', 'altText', 'sortOrder', 'width', 'height'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri', description: 'Optimized student-facing image' },
            thumbnailUrl: { type: 'string', format: 'uri', description: 'Optimized management and feed thumbnail' },
            altText: { type: 'string', maxLength: 240 },
            caption: { type: 'string', maxLength: 500, nullable: true },
            sectionId: { type: 'string', nullable: true },
            sortOrder: { type: 'integer', minimum: 0 },
            width: { type: 'integer', minimum: 1 },
            height: { type: 'integer', minimum: 1 },
            bytes: { type: 'integer', minimum: 1 },
            format: { type: 'string' },
          },
        },
        AnnouncementMediaWrite: {
          type: 'object',
          required: ['id', 'altText'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            altText: { type: 'string', minLength: 1, maxLength: 240 },
            caption: { type: 'string', maxLength: 500, nullable: true },
            sectionId: { type: 'string', nullable: true },
          },
        },
        AnnouncementDocument: {
          type: 'object',
          required: ['version', 'sections'],
          properties: {
            version: { type: 'integer', enum: [1] },
            sections: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: { $ref: '#/components/schemas/AnnouncementSection' },
            },
          },
        },
        AnnouncementSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            category: { type: 'string', enum: ['general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency'] },
            priority: { type: 'string', enum: ['normal', 'important', 'urgent'] },
            status: { type: 'string', enum: ['draft', 'published', 'archived'] },
            isPinned: { type: 'boolean' },
            version: { type: 'integer' },
            publishedAt: { type: 'string', format: 'date-time', nullable: true },
            updatedAt: { type: 'string', format: 'date-time' },
            isUnread: { type: 'boolean', description: 'Student feed responses only' },
          },
        },
        AnnouncementWrite: {
          type: 'object',
          required: ['title', 'summary', 'content'],
          properties: {
            title: { type: 'string', maxLength: 180 },
            summary: { type: 'string', maxLength: 500 },
            content: { $ref: '#/components/schemas/AnnouncementDocument' },
            rawSource: { type: 'string', maxLength: 50000, description: 'Staff-only original source material' },
            category: { type: 'string', enum: ['general', 'academic', 'practical', 'finance', 'event', 'opportunity', 'emergency'] },
            priority: { type: 'string', enum: ['normal', 'important', 'urgent'] },
            sourceType: { type: 'string', enum: ['official_class', 'educational_contribution', 'lecturer_information', 'external_information'] },
            contributorName: { type: 'string', nullable: true },
            contributorCredit: { type: 'string', nullable: true },
            isPinned: { type: 'boolean' },
            paymentEventId: { type: 'string', format: 'uuid', nullable: true },
            expectedVersion: { type: 'integer', minimum: 1, description: 'Required when updating an existing announcement' },
            changeNote: { type: 'string', maxLength: 300 },
            aiReview: {
              type: 'object',
              description: 'Selective acceptance record for a validated assistant run',
              properties: {
                runId: { type: 'string', format: 'uuid' },
                acceptedFields: { type: 'array', items: { type: 'string', enum: ['title', 'summary', 'category', 'priority', 'sections'] } },
                acceptedSectionIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        AnnouncementAiOrganization: {
          type: 'object',
          properties: {
            runId: { type: 'string', format: 'uuid' },
            suggestion: {
              type: 'object',
              properties: {
                title: { type: 'object', properties: { value: { type: 'string' }, sourceQuotes: { type: 'array', items: { type: 'string' } } } },
                summary: { type: 'object', properties: { value: { type: 'string' }, sourceQuotes: { type: 'array', items: { type: 'string' } } } },
                category: { type: 'object', properties: { value: { type: 'string' }, reason: { type: 'string' } } },
                priority: { type: 'object', properties: { value: { type: 'string' }, reason: { type: 'string' } } },
                sections: {
                  type: 'array',
                  items: {
                    allOf: [
                      { $ref: '#/components/schemas/AnnouncementSection' },
                      { type: 'object', properties: { sourceQuotes: { type: 'array', items: { type: 'string' } } } },
                    ],
                  },
                },
                warnings: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, sourceQuote: { type: 'string', nullable: true } } } },
                splitSuggestions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' }, sourceQuote: { type: 'string' } } } },
              },
            },
            audit: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' }, promptVersion: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './src/swaggerDocs/*.ts'],
};

export default swaggerJsdoc(options);
