const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

exports.generateInvoice = async (order, user, savePath) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });

        // Stream to file
        const invoiceStream = fs.createWriteStream(savePath);
        doc.pipe(invoiceStream);

        // Header
        doc.fontSize(20).text('INVOICE', { align: 'center' }).moveDown();

        // User Info
        doc.fontSize(12).text(`Customer: ${user.name}`);
        doc.text(`Email: ${user.email}`);
        doc.text(`Order ID: ${order._id}`);
        doc.text(`Order Date: ${new Date(order.createdAt).toLocaleDateString()}`).moveDown();

        // Shipping Info
        doc.fontSize(14).text('Shipping Address:', { underline: true });
        const s = order.shippingAddress || {};  // Changed from shippingAdress to shippingAddress
        if (s.fullName) {
            doc.fontSize(12).text(`${s.fullName}`);
            const addressParts = [
                s.street,
                s.city,
                s.country,
                s.postalCode
            ].filter(Boolean).join(', ');
            doc.text(addressParts);
            if (s.phone) doc.text(`Phone: ${s.phone}`);
        } else {
            doc.fontSize(12).text('No shipping address provided');
        }
        doc.moveDown();

        // Order Items
        doc.fontSize(14).text('Items:', { underline: true });
        doc.moveDown(0.5);
        order.orderItems.forEach((item, i) => {
            doc.text(`${i + 1}. ${item.name} - ${item.quantity} x $${item.price.toFixed(2)} = $${(item.quantity * item.price).toFixed(2)}`);
        });

        doc.moveDown();

        // Payment Summary
        doc.fontSize(14).text('Summary:', { underline: true });
        doc.fontSize(12).text(`Payment Method: ${order.paymentMethod}`);
        doc.text(`Total: $${order.totalAmount.toFixed(2)}`);
        doc.text(`Payment Status: ${order.paymentStatus}`);
        doc.text(`Order Status: ${order.status}`);
        doc.text(`Paid At: ${order.paidAt ? new Date(order.paidAt).toLocaleString() : 'Not yet'}`);

        // Footer
        doc.moveDown(2).fontSize(10).text('Thank you for your purchase!', { align: 'center' });

        doc.end();

        invoiceStream.on('finish', () => resolve());
        invoiceStream.on('error', err => reject(err));
    });
};
