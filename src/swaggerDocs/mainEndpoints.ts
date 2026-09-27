/**
 * @openapi
 * tags:
 *   - name: Payment Events
 *     description: Payment collection event management and public lookup
 *   - name: Payment Receipts
 *     description: Receipt upload, review, export, and ticket claiming
 *   - name: Transactions
 *     description: Public transparency ledger and finance transaction management
 *   - name: System
 *     description: Health and warmup endpoints
 *
 * /api/warmup:
 *   get:
 *     tags: [System]
 *     summary: Warm the API process and database connection
 *     description: Used by keep-alive automation. If WARMUP_TOKEN is configured, send it as x-warmup-token.
 *     parameters:
 *       - in: header
 *         name: x-warmup-token
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API and database are warm
 *       404:
 *         description: Missing or invalid warmup token when configured
 *
 * /api/payment-events:
 *   get:
 *     tags: [Payment Events]
 *     summary: List payment events
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated payment events with receipt stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/PaymentEvent' }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 totalPages: { type: integer }
 *   post:
 *     tags: [Payment Events]
 *     summary: Create a payment event
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, amount, accountNumber, accountName, bankName, deadline]
 *             properties:
 *               title: { type: string }
 *               description: { type: string, nullable: true }
 *               amount: { type: string, example: '5000' }
 *               accountNumber: { type: string }
 *               accountName: { type: string }
 *               bankName: { type: string }
 *               deadline: { type: string, format: date-time }
 *               hasTickets: { type: boolean }
 *     responses:
 *       201:
 *         description: Payment event created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaymentEvent' }
 *
 * /api/payment-events/slug/{slug}:
 *   get:
 *     tags: [Payment Events]
 *     summary: Public payment event lookup by slug
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Public payment event details
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaymentEvent' }
 *
 * /api/payment-events/id/{id}:
 *   get:
 *     tags: [Payment Events]
 *     summary: Get payment event by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment event with receipt stats
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaymentEvent' }
 *
 * /api/payment-events/{id}:
 *   patch:
 *     tags: [Payment Events]
 *     summary: Update payment event options
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hasTickets: { type: boolean }
 *               description: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Updated payment event
 *   delete:
 *     tags: [Payment Events]
 *     summary: Soft-delete a payment event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment event deleted
 *
 * /api/payment-events/{id}/close:
 *   patch:
 *     tags: [Payment Events]
 *     summary: Toggle payment event open/closed state
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated payment event
 *
 * /api/payment-events/{id}/extend:
 *   patch:
 *     tags: [Payment Events]
 *     summary: Extend/reopen a payment event deadline
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deadline]
 *             properties:
 *               deadline: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Updated payment event
 *
 * /api/payment-receipts:
 *   post:
 *     tags: [Payment Receipts]
 *     summary: Public receipt upload
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [eventId, fullName, matricNumber, receipt]
 *             properties:
 *               eventId: { type: string, format: uuid }
 *               fullName: { type: string }
 *               matricNumber: { type: string }
 *               level: { type: string, nullable: true }
 *               receipt:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Receipt submitted
 *
 * /api/payment-receipts/{eventId}:
 *   get:
 *     tags: [Payment Receipts]
 *     summary: List payment receipts for an event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Searches fullName and matricNumber when at least 2 characters
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, rejected] }
 *     responses:
 *       200:
 *         description: Paginated receipts with event totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 receipts:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/PaymentReceipt' }
 *                 total: { type: integer }
 *                 confirmedTotal: { type: integer }
 *                 rejectedTotal: { type: integer }
 *                 pendingTotal: { type: integer }
 *                 claimedTotal: { type: integer }
 *                 page: { type: integer }
 *                 totalPages: { type: integer }
 *                 limit: { type: integer }
 *
 * /api/payment-receipts/{eventId}/export:
 *   get:
 *     tags: [Payment Receipts]
 *     summary: Export payment receipts to Excel
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *
 * /api/payment-receipts/status/{id}:
 *   get:
 *     tags: [Payment Receipts]
 *     summary: Public receipt status lookup
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Receipt review status and ticket data when enabled
 *
 * /api/payment-receipts/my-tickets:
 *   get:
 *     tags: [Payment Receipts]
 *     summary: Public confirmed ticket lookup by matric number
 *     parameters:
 *       - in: query
 *         name: matricNumber
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Confirmed tickets for the matric number
 *
 * /api/payment-receipts/scan:
 *   post:
 *     tags: [Payment Receipts]
 *     summary: Claim/collect a payment ticket by QR or code
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Claim result
 *
 * /api/payment-receipts/{id}/confirm:
 *   patch:
 *     tags: [Payment Receipts]
 *     summary: Confirm a payment receipt and create/restore its ledger credit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Updated receipt
 *
 * /api/payment-receipts/{id}/reject:
 *   patch:
 *     tags: [Payment Receipts]
 *     summary: Reject a payment receipt and soft-delete its ledger credit if needed
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Updated receipt
 *
 * /api/transparency/ledger:
 *   get:
 *     tags: [Transactions]
 *     summary: Public transparency ledger
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [credit, debit] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ledger totals and paginated transactions
 *
 * /api/transparency/verify-matric:
 *   post:
 *     tags: [Transactions]
 *     summary: Verify matric number before showing transparency page
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [matricNumber]
 *             properties:
 *               matricNumber: { type: string }
 *     responses:
 *       200:
 *         description: Matric number found
 *
 * /api/transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: Admin transaction list
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [credit, debit] }
 *       - in: query
 *         name: includeDeleted
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated admin ledger
 *   post:
 *     tags: [Transactions]
 *     summary: Create manual transaction
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [type, amount, description, occurredAt]
 *             properties:
 *               type: { type: string, enum: [credit, debit] }
 *               amount: { type: string }
 *               description: { type: string }
 *               category: { type: string }
 *               occurredAt: { type: string, format: date-time }
 *               proof: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Transaction created
 *
 * /api/transactions/{id}:
 *   patch:
 *     tags: [Transactions]
 *     summary: Update manual transaction
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, enum: [credit, debit] }
 *               amount: { type: string }
 *               description: { type: string }
 *               category: { type: string }
 *               occurredAt: { type: string, format: date-time }
 *               proof: { type: string, format: binary }
 *               removeProof: { type: boolean }
 *     responses:
 *       200:
 *         description: Transaction updated
 *   delete:
 *     tags: [Transactions]
 *     summary: Soft-delete manual transaction
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Transaction deleted
 */
export {};
