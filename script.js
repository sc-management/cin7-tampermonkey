// ==UserScript==
// @name         Cin7 extension
// @namespace    https://bcosys.world/
// @version      2024-04-08
// @description  try to take over the world!
// @author       Yihui Liu
// @match        https://inventory.dearsystems.com/Purchase
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        GM.xmlHttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = 'https://k0g8rklnp6.execute-api.us-east-1.amazonaws.com/dev';

    const saveButtonGroup = document.getElementsByClassName('save-button-bottom')[0];
    const newButton = document.createElement('button');
    newButton.textContent = 'Ship';
    newButton.style.marginBottom = '5px';
    newButton.addEventListener('click', addShipment);
    saveButtonGroup.insertBefore(newButton, saveButtonGroup.children[0]);

    const topBarButtons = document.querySelector('.page-top-bar .align-right');
    const newButton2 = document.createElement('button');
    newButton2.textContent = 'Add Shipment';
    newButton2.className = 'btn btn-outline btn-small';
    newButton2.addEventListener('click', addShipment);
    topBarButtons.insertBefore(newButton2, topBarButtons.children[0]);

    const orderButtonGroup = document.querySelector('#divOrder .align-right');
    const orderAuthorizeButton = document.querySelector('#divAuthorise_Order');
    const includeShipmentButton = document.createElement('button');
    includeShipmentButton.textContent = 'Include Shipment';
    includeShipmentButton.className = 'btn btn-outline';
    includeShipmentButton.addEventListener('click', includeShipment);
    orderButtonGroup.insertBefore(includeShipmentButton, orderAuthorizeButton);

    function includeShipmentPrice (totalShipmentPrice, resultTable) {
        const ordersForm = document.getElementById('divOrderLinesForm');
        const orders = ordersForm.querySelectorAll('tr.x-grid-row');
        const products = [];
        let totalQuantity = 0;
        for (const order of orders) {
            const productNameBlock = order.querySelector('.product-text span span') || order.querySelector('deartooltip productname');
            const productName = productNameBlock?.textContent;
            const productIdBlock = order.querySelector('deartooltip productid');
            const productId = productIdBlock?.textContent;
            const unitBlock = order.querySelector('.x-grid-cell-colUnitOfMeasure_OrderLines');
            const unit = unitBlock.textContent;
            const quantityBlock = order.querySelector('.x-grid-cell-colQuantity_OrderLines');
            const quantity = Number(quantityBlock.textContent);
            totalQuantity += quantity;
            const priceBlock = order.querySelector('.x-grid-cell-colPrice_OrderLines');
            const price = Number(priceBlock.textContent.replaceAll(",", ""));
            const totalBlock = order.querySelector('.x-grid-cell-colTotal_OrderLines');
            const total = Number(totalBlock.textContent.replaceAll(",", ""));
            products.push({
                productId,
                productName,
                unit,
                quantity,
                price,
                total,
            });
        }


        // clear result table tbody
        resultTable.querySelector('tbody').innerHTML = '';

        for (let i = 0; i < products.length; i++) {
            const product = products[i];
            const shipmentPrice = totalShipmentPrice * (product.quantity / totalQuantity);
            const newPrice = (product.total + shipmentPrice) / product.quantity;
            const newPriceRounded = Math.round(newPrice * 10000) / 10000;
            products[i].updatedPrice = newPriceRounded;
            const resultTr = document.createElement('tr');
            const resultNameTd = document.createElement('td');
            resultNameTd.textContent = product.productName;
            resultNameTd.style.padding = '0 5px';
            const resultPriceTd = document.createElement('td');
            resultPriceTd.textContent = `$${newPriceRounded}`;
            resultPriceTd.style.padding = '0 5px';
            resultTr.append(resultNameTd);
            resultTr.append(resultPriceTd);
            resultTable.querySelector('tbody').append(resultTr);
        }

        return products;
    }

    function includeShipment () {
        let products = [];
        GM.xmlHttpRequest({
            method: 'GET',
            url: `${API_URL}/cin7/shipments`,
            onload: function (response) {
                console.log(response);
                if (response.status === 200) {
                    const shipments = JSON.parse(response.response);
                    console.log(shipments);
                    const dialog = document.createElement('dialog');
                    dialog.setAttribute('open', true);
                    dialog.style.zIndex = 999;
                    const form = document.createElement('form');

                    const resultTable = document.createElement('table');
                    resultTable.style.width = '100%';
                    const resultHeader = document.createElement('thead');
                    const resultNameTh = document.createElement('th');
                    resultNameTh.style.padding = '0 5px';
                    resultNameTh.textContent = 'Name';
                    const resultPriceTh = document.createElement('th');
                    resultPriceTh.textContent = 'Price';
                    resultPriceTh.style.padding = '0 5px';
                    const resultBody = document.createElement('tbody');
                    resultHeader.append(resultNameTh);
                    resultHeader.append(resultPriceTh);
                    resultTable.append(resultHeader);
                    resultTable.append(resultBody);


                    form.addEventListener('submit', (e) => {
                        e.preventDefault();

                        // get selected shipment PKs
                        const selectedShipmentPKs = [];
                        const checkboxes = form.querySelectorAll('input[name="shipment"]');
                        for (const checkbox of checkboxes) {
                            if (checkbox.checked) {
                                selectedShipmentPKs.push(checkbox.value);
                            }
                        }

                        // get shipments
                        const selectedShipments = shipments.filter((shipment) =>
                            selectedShipmentPKs.includes(shipment.PK));

                        const totalShipmentPrice = selectedShipments.reduce((acc, shipment) => acc + shipment.price, 0) / 100;
                        products = includeShipmentPrice(totalShipmentPrice, resultTable);
                        console.log(products);
                        const applyButton = document.getElementById('calApplyButton');
                        applyButton.style.display = 'block';

                        return false;
                    });
                    const table = document.createElement('table');
                    table.style.width = '100%';
                    const header = document.createElement('thead');
                    const checkTh = document.createElement('th');
                    checkTh.textContent = 'Select';
                    checkTh.style.padding = '0 5px';
                    checkTh.style.borderBottom = '1px solid #e0e0e0';
                    checkTh.style.textAlign = 'center';
                    const vendorTh = document.createElement('th');
                    vendorTh.textContent = 'Vendor';
                    vendorTh.style.padding = '0 5px';
                    vendorTh.style.borderBottom = '1px solid #e0e0e0';
                    vendorTh.style.textAlign = 'center';
                    const dateTh = document.createElement('th');
                    dateTh.textContent = 'Date';
                    dateTh.style.padding = '0 5px';
                    dateTh.style.borderBottom = '1px solid #e0e0e0';
                    dateTh.style.textAlign = 'center';
                    const priceTh = document.createElement('th');
                    priceTh.textContent = 'Total';
                    priceTh.style.padding = '0 5px';
                    priceTh.style.borderBottom = '1px solid #e0e0e0';
                    priceTh.style.textAlign = 'center';
                    const refTh = document.createElement('th');
                    refTh.textContent = 'Ref';
                    refTh.style.padding = '0 5px';
                    refTh.style.borderBottom = '1px solid #e0e0e0';
                    refTh.style.textAlign = 'center';
                    const actionTh = document.createElement('th');
                    actionTh.textContent = 'Action';
                    actionTh.style.padding = '0 5px';
                    actionTh.style.borderBottom = '1px solid #e0e0e0';
                    actionTh.style.textAlign = 'center';

                    header.append(checkTh);
                    header.append(vendorTh);
                    header.append(dateTh);
                    header.append(refTh);
                    header.append(priceTh);
                    header.append(actionTh);
                    table.append(header);
                    for (const shipment of shipments) {
                        const tr = document.createElement('tr');
                        // add checkbox input
                        const checkTd = document.createElement('td');
                        const checkInput = document.createElement('input');
                        checkInput.type = 'checkbox';
                        checkInput.value = shipment.PK;
                        checkInput.name = 'shipment';
                        checkTd.append(checkInput);
                        checkTd.style.padding = '0 5px';
                        checkTd.style.textAlign = 'center';
                        checkTd.style.borderBottom = '1px solid #e0e0e0';
                        tr.append(checkTd);
                        // add vendor
                        const vendorTd = document.createElement('td');
                        vendorTd.textContent = shipment.vendor;
                        vendorTd.style.padding = '0 5px';
                        vendorTd.style.borderBottom = '1px solid #e0e0e0';
                        vendorTd.style.textAlign = 'center';
                        tr.append(vendorTd);
                        // add date
                        const dateTd = document.createElement('td');
                        dateTd.textContent = shipment.shipmentCreatedDate;
                        dateTd.style.padding = '0 5px';
                        dateTd.style.borderBottom = '1px solid #e0e0e0';
                        dateTd.style.textAlign = 'center';
                        tr.append(dateTd);
                        // add ref
                        const refTd = document.createElement('td');
                        refTd.textContent = shipment.ref;
                        refTd.style.padding = '0 5px';
                        refTd.style.borderBottom = '1px solid #e0e0e0';
                        refTd.style.textAlign = 'center';
                        tr.append(refTd);
                        // add price
                        const priceTd = document.createElement('td');
                        priceTd.textContent = `$${shipment.price / 100}`;
                        priceTd.style.padding = '0 5px';
                        priceTd.style.borderBottom = '1px solid #e0e0e0';
                        priceTd.style.textAlign = 'center';
                        tr.append(priceTd);
                        const actionTd = document.createElement('td');
                        const removeButton = document.createElement('button');
                        removeButton.textContent = 'Remove';
                        removeButton.className = 'btn btn-outline btn-small';
                        removeButton.addEventListener('click', (e) => {
                            e.preventDefault();
                            GM.xmlHttpRequest({
                                method: 'DELETE',
                                url: `${API_URL}/cin7/shipment/${shipment.PK.split('#')[1]}`,
                                onload: function (response) {
                                    console.log(response);
                                    if (response.status === 200) {
                                        const responseJSON = JSON.parse(response.response);
                                        alert(responseJSON.message || 'Done');
                                        tr.remove();
                                    }
                                },
                            });
                        });
                        actionTd.append(removeButton);
                        actionTd.style.padding = '0 5px';
                        actionTd.style.borderBottom = '1px solid #e0e0e0';
                        actionTd.style.textAlign = 'center';
                        tr.append(actionTd);
                        table.append(tr);
                    }

                    const buttonGroup = document.createElement('div');
                    buttonGroup.style.display = 'flex';
                    const includeButton = document.createElement('input');
                    includeButton.value = 'Calculate';
                    includeButton.type = 'submit';
                    includeButton.className = 'btn btn-primary';
                    const applyButton = document.createElement('button');
                    applyButton.id = 'calApplyButton';
                    applyButton.textContent = 'Apply';
                    applyButton.className = 'btn btn-outline';
                    applyButton.style.display = 'none';
                    applyButton.addEventListener('click', (e) => {
                        e.preventDefault();

                        const taskId = document?.getElementById('IDToUpload')?.value;
                        if (!taskId) {
                            alert('Please save the order first');
                            return;
                        }

                        if (products.length === 0) {
                            alert('Please calculate first');
                            return;
                        }

                        const body = {
                            products,
                        }

                        GM.xmlHttpRequest({
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            url: `${API_URL}/cin7/purchase-order/${taskId}`,
                            data: JSON.stringify(body),
                            onload: function (response) {
                                console.log(response);
                                if (response.status === 200) {
                                    // get selected checkbox
                                    const checkboxes = form.querySelectorAll('input[name="shipment"]');
                                    for (const checkbox of checkboxes) {
                                        if (checkbox.checked) {
                                            const shipmentPK = checkbox.value;
                                            // delete shipment
                                            GM.xmlHttpRequest({
                                                method: 'DELETE',
                                                url: `${API_URL}/cin7/shipment/${shipmentPK.split('#')[1]}`,
                                                onload: function (response) {
                                                    console.log(response);
                                                    if (response.status === 200) {
                                                        checkbox.parentElement.parentElement.remove();
                                                    }
                                                },
                                            });
                                        }
                                    }

                                    alert('Done, page will be reloaded');
                                    window.location.reload();
                                } else {
                                    const message = JSON.parse(response.response).message;
                                    alert(message || 'Error, please try again or contact support');
                                }
                            },
                            onerror: function (response) {
                                const message = JSON.parse(response.response).message;
                                alert(message || 'Error, please try again or contact support');
                            }
                        });

                        dialog.remove();
                    });


                    const cancelButton = document.createElement('button');
                    cancelButton.textContent = 'Cancel';
                    cancelButton.className = 'btn btn-outline';
                    cancelButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        dialog.remove();
                    });
                    buttonGroup.append(includeButton);
                    buttonGroup.append(applyButton);
                    buttonGroup.append(cancelButton);

                    form.append(table);
                    form.append(buttonGroup);
                    dialog.append(form);
                    dialog.append(resultTable);
                    document.querySelector('.dr-warning').append(dialog);
                }
            },
        });
    }


    function addShipment () {
        const vendorInput = document.getElementById('cmbSupplier');
        const dateInput = document.getElementById('dtDate');

        const shippingCosts = document.querySelectorAll('#divOrderAdditionalCostLines .x-grid-row');
        const shipments = [];
        for (const shippingCost of shippingCosts) {
            const tds = shippingCost.querySelectorAll('td');
            const ref = tds[2].textContent;
            const quantity = Number(tds[3].textContent);
            const price = Number(tds[4].textContent.replaceAll(",", ""));
            const total = Number(tds[7].textContent.replaceAll(",", ""));
            const shipping = {
                ref,
                quantity,
                price,
                total,
            }
            shipments.push(shipping);
        }

        const vendor = vendorInput.value;
        const date = dateInput.value;

        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', true);
        dialog.style.zIndex = 999;
        const title = document.createElement('h2');
        title.textContent = 'Do you want to add following shipment(s)?'
        const form = document.createElement('form');
        const table = document.createElement('table');
        table.style.width = '100%';
        const header = document.createElement('thead');
        const vendorTh = document.createElement('th');
        vendorTh.textContent = 'Vendor';
        vendorTh.style.padding = '0 5px';
        vendorTh.style.borderBottom = '1px solid #e0e0e0';
        vendorTh.style.textAlign = 'center';
        const dateTh = document.createElement('th');
        dateTh.textContent = 'Date';
        dateTh.style.padding = '0 5px';
        dateTh.style.borderBottom = '1px solid #e0e0e0';
        dateTh.style.textAlign = 'center';
        const refTh = document.createElement('th');
        refTh.textContent = 'Ref';
        refTh.style.padding = '0 5px';
        refTh.style.borderBottom = '1px solid #e0e0e0';
        refTh.style.textAlign = 'center';
        const quantityTh = document.createElement('th');
        quantityTh.textContent = 'Quantity';
        quantityTh.style.padding = '0 5px';
        quantityTh.style.borderBottom = '1px solid #e0e0e0';
        quantityTh.style.textAlign = 'center';
        const priceTh = document.createElement('th');
        priceTh.textContent = 'Price';
        priceTh.style.padding = '0 5px';
        priceTh.style.borderBottom = '1px solid #e0e0e0';
        priceTh.style.textAlign = 'center';
        const totalTh = document.createElement('th');
        totalTh.textContent = 'Total';
        totalTh.style.padding = '0 5px';
        totalTh.style.borderBottom = '1px solid #e0e0e0';
        totalTh.style.textAlign = 'center';
        header.append(vendorTh);
        header.append(dateTh);
        header.append(refTh);
        header.append(quantityTh);
        header.append(priceTh);
        header.append(totalTh);
        table.append(header);
        const body = document.createElement('tbody');
        for (let i = 0; i < shipments.length; i++) {
            const tr = document.createElement('tr');
            const vendorTd = document.createElement('td');
            vendorTd.textContent = vendor;
            vendorTd.style.padding = '0 5px';
            vendorTd.style.borderBottom = '1px solid #e0e0e0';
            vendorTd.style.textAlign = 'center';
            tr.append(vendorTd);
            const dateTd = document.createElement('td');
            dateTd.textContent = date;
            dateTd.style.padding = '0 5px';
            dateTd.style.borderBottom = '1px solid #e0e0e0';
            dateTd.style.textAlign = 'center';
            tr.append(dateTd);
            const refTd = document.createElement('td');
            refTd.textContent = shipments[i].ref;
            refTd.style.padding = '0 5px';
            refTd.style.borderBottom = '1px solid #e0e0e0';
            refTd.style.textAlign = 'center';
            tr.append(refTd);
            const quantityTd = document.createElement('td');
            quantityTd.textContent = shipments[i].quantity;
            quantityTd.style.padding = '0 5px';
            quantityTd.style.borderBottom = '1px solid #e0e0e0';
            quantityTd.style.textAlign = 'center';
            tr.append(quantityTd);
            const priceTd = document.createElement('td');
            priceTd.textContent = `$${shipments[i].price}`;
            priceTd.style.padding = '0 5px';
            priceTd.style.borderBottom = '1px solid #e0e0e0';
            priceTd.style.textAlign = 'center';
            tr.append(priceTd);
            const totalTd = document.createElement('td');
            totalTd.textContent = `$${shipments[i].total}`;
            totalTd.style.padding = '0 5px';
            totalTd.style.borderBottom = '1px solid #e0e0e0';
            totalTd.style.textAlign = 'center';
            tr.append(totalTd);
            body.append(tr);
        }

        table.append(body);
        const buttonGroup = document.createElement('div');
        const confirmButton = document.createElement('input');
        // submit  button
        confirmButton.className = 'btn btn-primary';
        confirmButton.type = 'submit';
        confirmButton.value = 'Confirm';

        const cancelButton = document.createElement('button');
        cancelButton.className = 'btn btn-outline'
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', (e) => {e.preventDefault(); dialog.remove();});
        buttonGroup.append(confirmButton);
        buttonGroup.append(cancelButton);

        form.addEventListener('submit', (e) => {
           e.preventDefault();
           for (const shipment of shipments) {
                const shipmentData = {
                     vendor,
                     shipmentCreatedDate: date,
                     ref: shipment.ref,
                     quantity: shipment.quantity,
                     unitPrice: shipment.price * 100,
                     price: shipment.total * 100,
                }

                GM.xmlHttpRequest({
                     method: 'POST',
                     url: `${API_URL}/cin7/shipment`,
                     data: JSON.stringify(shipmentData),
                });
           }

           alert('Done');
           dialog.remove();
           return false;
        });

        form.append(table);
        form.append(buttonGroup);
        dialog.append(title);
        dialog.append(form);

        document.querySelector('.dr-warning').append(dialog);
    }
})();
