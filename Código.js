/**
* (MODIFICADO)
* Eliminada la lógica de 'payment_id' de Mercado Pago.
*/
function doGet(e) {
  try {
    const params = e.parameter;
    Logger.log("doGet INICIADO. Parámetros de URL: " + JSON.stringify(params));

    const appUrl = ScriptApp.getService().getUrl();
    const htmlTemplate = HtmlService.createTemplateFromFile('Index');
    htmlTemplate.appUrl = appUrl;

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    htmlTemplate.pagoTotalMPVisible = hojaConfig.getRange('B24').getValue(); 
    
    htmlTemplate.dniHermano = '';
    htmlTemplate.tipoHermano = '';
    htmlTemplate.nombreHermano = '';
    htmlTemplate.apellidoHermano = '';
    htmlTemplate.fechaNacHermano = '';

    const html = htmlTemplate.evaluate()
      .setTitle("Formulario de Registro")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return html;

  } catch (err) {
    Logger.log("Error en la detección de parámetros de doGet: " + err.toString());
    return HtmlService.createHtmlOutput("<b>Ocurrió un error:</b> " + err.message);
  }
}

/**
* (MODIFICADO)
* 'doPost' ya no es necesario para el webhook de MP.
*/
function doPost(e) {
  Logger.log("doPost llamado pero Mercado Pago está deshabilitado.");
  return ContentService.createTextOutput("OK");
}

function registrarDatos(datos) {
  Logger.log("REGISTRAR DATOS INICIADO. Datos: " + JSON.stringify(datos));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);

    const fechaNacPrincipal = datos.fechaNacimiento;
    if (!fechaNacPrincipal || fechaNacPrincipal < "2010-01-01" || fechaNacPrincipal > "2023-12-31") {
      return { status: 'ERROR', message: 'La fecha de nacimiento del inscripto principal debe estar entre 01/01/2010 y 31/12/2023.' };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    let estadoActual = obtenerEstadoRegistro();

    if (estadoActual.cierreManual) return { status: 'CERRADO', message: 'El registro se encuentra cerrado.' };
    if (datos.tipoInscripto !== 'preventa' && estadoActual.alcanzado) return { status: 'LIMITE_ALCANZADO', message: 'Se ha alcanzado el cupo máximo.' };
    if (datos.tipoInscripto !== 'preventa' && datos.jornada === 'Jornada Normal extendida' && estadoActual.jornadaExtendidaAlcanzada) {
      return { status: 'LIMITE_EXTENDIDA', message: 'Se agotó el cupo para Jornada Extendida.' };
    }

    const dniBuscado = limpiarDNI(datos.dni);
    let hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    let rangoDniRegistro = null;
    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    }

    if (rangoDniRegistro) {
      const celdaRegistro = rangoDniRegistro.createTextFinder(dniBuscado).matchEntireCell(true).findNext();
      if (celdaRegistro) {
        Logger.log(`BLOQUEO DE REGISTRO: El DNI ${dniBuscado} ya existe en la fila ${celdaRegistro.getRow()}.`);
        return { status: 'ERROR', message: `El DNI ${dniBuscado} ya se encuentra registrado. No se puede crear un duplicado.` };
      }
    }

    if (!hojaRegistro) {
      hojaRegistro = ss.insertSheet(NOMBRE_HOJA_REGISTRO);
      hojaRegistro.appendRow(['N° de Turno', 'Marca temporal', 'Marca N/E', 'Estado', 'Email', 'Nombre', 'Apellido', 'Fecha de Nacimiento', 'GRUPOS', 'DNI', 'Obra Social', 'Colegio/Jardin', 'Responsable 1', 'DNI Resp 1', 'Tel Resp 1', 'Responsable 2', 'Tel Resp 2', 'Autorizados', 'Deporte', 'Espec. Deporte', 'Enfermedad', 'Espec. Enfermedad', 'Alergia', 'Espec. Alergia', 'Aptitud Física (Link)', 'Foto Carnet (Link)', 'Jornada', 'SOCIO', 'Método de Pago', 'Precio', 'Cuota 1', 'Cuota 2', 'Cuota 3', 'Cantidad Cuotas', 'Estado de Pago', 'Monto a Pagar', 'ID Pago MP', 'Nombre Pagador (MP)', 'DNI Pagador MP', 'Nombre y Apellido (Pagador Manual)', 'DNI Pagador (Manual)', 'Comprobante MP', 'Comprobante Manual (Total/Ext)', 'Comprobante Manual (C1)', 'Comprobante Manual (C2)', 'Comprobante Manual (C3)', 'Enviar Email?', 'Turno Principal']);
      rangoDniRegistro = null;
    }

    const { precio, montoAPagar } = obtenerPrecioDesdeConfig(datos.metodoPago, datos.cantidadCuotas, hojaConfig);
    const lastRow = hojaRegistro.getLastRow();
    let ultimoTurno = 0;
    if (lastRow > 1) {
      const rangoTurnos = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1).getValues();
      const turnosReales = rangoTurnos.map(f => f[0]).filter(Number);
      if (turnosReales.length > 0) ultimoTurno = Math.max(...turnosReales);
    }
    const nuevoNumeroDeTurno = ultimoTurno + 1;

    const edadCalculada = calcularEdad(datos.fechaNacimiento);
    const textoGrupo = `GRUPO ${edadCalculada.anos} AÑOS`;
    const fechaFormateada = Utilities.formatDate(new Date(datos.fechaNacimiento), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const esPreventa = (datos.tipoInscripto === 'preventa');
    let marcaNE = datos.jornada === 'Jornada Normal extendida' ? (esPreventa ? "Extendida (Pre-venta)" : "Extendida") : (esPreventa ? "Normal (Pre-Venta)" : "Normal");
    let estadoInscripto = esPreventa ? "Pre-Venta" : (datos.tipoInscripto === 'nuevo' ? 'Nuevo' : 'Anterior');
    const telResp1 = `(${datos.telAreaResp1}) ${datos.telNumResp1}`;
    const telResp2 = (datos.telAreaResp2 && datos.telNumResp2) ? `(${datos.telAreaResp2}) ${datos.telNumResp2}` : '';

    const filaNueva = [nuevoNumeroDeTurno, new Date(), marcaNE, estadoInscripto, datos.email, datos.nombre, datos.apellido, fechaFormateada, textoGrupo, dniBuscado, datos.obraSocial, datos.colegioJardin, datos.adultoResponsable1, datos.dniResponsable1, telResp1, datos.adultoResponsable2, telResp2, datos.personasAutorizadas, datos.practicaDeporte, datos.especifiqueDeporte, datos.tieneEnfermedad, datos.especifiqueEnfermedad, datos.esAlergico, datos.especifiqueAlergia, datos.urlCertificadoAptitud || '', datos.urlFotoCarnet || '', datos.jornada, datos.esSocio, datos.metodoPago, precio, '', '', '', parseInt(datos.cantidadCuotas) || 0, datos.estadoPago, montoAPagar, '', '', '', '', '', '', '', '', '', '', false, nuevoNumeroDeTurno];
    hojaRegistro.appendRow(filaNueva);
    const filaInsertada = hojaRegistro.getLastRow();

    aplicarColorGrupo(hojaRegistro, filaInsertada, textoGrupo, hojaConfig);
    // --- (MODIFICACIÓN) ---
    // La siguiente línea ha sido eliminada para que ya no se genere el checkbox en la columna AU.
    // hojaRegistro.getRange(filaInsertada, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule);
    // --- (FIN MODIFICACIÓN) ---
    hojaRegistro.getRange(filaInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0");

    let hermanosConEstado = [];
    if (datos.hermanos && datos.hermanos.length > 0) {
      const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow(), 1);
      let dnisHermanosEnEsteLote = new Set();
      let proximoTurnoHermano = nuevoNumeroDeTurno;

      for (const hermano of datos.hermanos) {
        proximoTurnoHermano++;
        const dniHermano = limpiarDNI(hermano.dni);
        if (!dniHermano || !hermano.nombre || !hermano.apellido || !hermano.fechaNac || !hermano.obraSocial || !hermano.colegio) continue;
        if (hermano.fechaNac < "2010-01-01" || hermano.fechaNac > "2023-12-31") return { status: 'ERROR', message: `La fecha de nacimiento del hermano/a (${hermano.nombre}) debe estar entre 01/01/2010 y 31/12/2023.` };
        if (dniHermano === dniBuscado) return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}) no puede ser igual al del inscripto principal.` };
        if (dnisHermanosEnEsteLote.has(dniHermano)) return { status: 'ERROR', message: `El DNI ${dniHermano} está repetido entre los hermanos. Por favor, revise los datos.` };
        dnisHermanosEnEsteLote.add(dniHermano);

        const celdaRegistroHermano = rangoDniRegistro.createTextFinder(dniHermano).matchEntireCell(true).findNext();
        if (celdaRegistroHermano) return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}: ${dniHermano}) ya se encuentra registrado.` };

        let estadoHermano = "Nuevo Hermano/a";
        if (hojaBusqueda && hojaBusqueda.getLastRow() > 1) {
          if (hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1).createTextFinder(dniHermano).matchEntireCell(true).findNext()) {
            estadoHermano = "Anterior Hermano/a";
          }
        }
        hermanosConEstado.push({ nombre: hermano.nombre, apellido: hermano.apellido, dni: dniHermano, tipo: estadoHermano.includes('Anterior') ? 'anterior' : 'nuevo' });

        const edadCalcHermano = calcularEdad(hermano.fechaNac);
        const textoGrupoHermano = `GRUPO ${edadCalcHermano.anos} AÑOS`;
        const fechaFmtHermano = Utilities.formatDate(new Date(hermano.fechaNac), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
        const filaHermano = [proximoTurnoHermano, new Date(), '', estadoHermano, datos.email, hermano.nombre, hermano.apellido, fechaFmtHermano, textoGrupoHermano, dniHermano, hermano.obraSocial, hermano.colegio, datos.adultoResponsable1, datos.dniResponsable1, telResp1, datos.adultoResponsable2, telResp2, datos.personasAutorizadas, '', '', '', '', '', '', '', '', '', '', '', 0, '', '', '', 0, 'Pendiente (Hermano)', 0, '', '', '', '', '', '', '', '', '', '', false, nuevoNumeroDeTurno];
        hojaRegistro.appendRow(filaHermano);
        const filaHermanoInsertada = hojaRegistro.getLastRow();
        aplicarColorGrupo(hojaRegistro, filaHermanoInsertada, textoGrupoHermano, hojaConfig);
        hojaRegistro.getRange(filaHermanoInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0");
      }
    }

    SpreadsheetApp.flush();
    obtenerEstadoRegistro();

    return { status: 'OK_REGISTRO', message: '¡Registro Exitoso!', numeroDeTurno: nuevoNumeroDeTurno, datos: datos, hermanosRegistrados: hermanosConEstado };
  } catch (e) {
    Logger.log("ERROR CRÍTICO EN REGISTRO: " + e.toString());
    return { status: 'ERROR', message: 'Fallo al registrar los datos: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// --- (INICIO DE MODIFICACIÓN) ---
// Funciones `subirComprobanteManual` y `uploadFileToDrive`
// reemplazadas por completo.
// =========================================================

/**
* (MODIFICADO)
* - Acepta un array `cuotasSeleccionadas`.
* - Determina los NUEVOS ESTADOS DE PAGO ("Pago Total Familiar", "Pago total en cuotas").
* - Construye el NUEVO NOMBRE DE ARCHIVO basado en las reglas.
* - Llama a `uploadFileToDrive` con el nuevo nombre.
* - Aplica el pago a toda la familia si `esPagoFamiliar` es true.
*/
function subirComprobanteManual(dni, fileData, cuotasSeleccionadas, datosExtras, esPagoFamiliar = false) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dniLimpio = limpiarDNI(dni);
    if (!dniLimpio || !fileData || !cuotasSeleccionadas || cuotasSeleccionadas.length === 0) {
      return { status: 'ERROR', message: 'Faltan datos (DNI, archivo o tipo de comprobante).' };
    }
    if (!datosExtras || !datosExtras.nombrePagador || !datosExtras.dniPagador) {
      return { status: 'ERROR', message: 'Faltan los datos del adulto pagador (Nombre o DNI).' };
    }
    if (!/^[0-9]{8}$/.test(datosExtras.dniPagador)) {
      return { status: 'ERROR', message: 'El DNI del pagador debe tener 8 dígitos.' };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hoja) throw new Error(`La hoja "${NOMBRE_HOJA_REGISTRO}" no fue encontrada.`);

    const rangoDni = hoja.getRange(2, COL_DNI_INSCRIPTO, hoja.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDni.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) {
      const fila = celdaEncontrada.getRow();
      const rangoFila = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0];
      
      const dniHoja = rangoFila[COL_DNI_INSCRIPTO - 1];
      const nombreHoja = rangoFila[COL_NOMBRE - 1];
      const apellidoHoja = rangoFila[COL_APELLIDO - 1];
      const metodoPagoHoja = rangoFila[COL_METODO_PAGO - 1] || 'Pago';
      const cantidadCuotasRegistrada = parseInt(rangoFila[COL_CANTIDAD_CUOTAS - 1]) || 3;
      
      const tipoComprobantePrincipal = cuotasSeleccionadas[0]; // Usamos el primero para la lógica principal
      let esPagoTotal = ['mp_total', 'externo'].includes(tipoComprobantePrincipal);
      let nuevoEstadoPago = "";
      
      // Determinar si es un pago total de cuotas
      if (!esPagoTotal && metodoPagoHoja === 'Pago en Cuotas') {
        const cuotasPagadasAhora = new Set(cuotasSeleccionadas);
        const [c1, c2, c3] = [rangoFila[COL_CUOTA_1 - 1], rangoFila[COL_CUOTA_2 - 1], rangoFila[COL_CUOTA_3 - 1]];
        let pagadasCount = 0;
        if (String(c1).startsWith("Pagada") || cuotasPagadasAhora.has('mp_cuota_1')) pagadasCount++;
        if (String(c2).startsWith("Pagada") || cuotasPagadasAhora.has('mp_cuota_2')) pagadasCount++;
        if (String(c3).startsWith("Pagada") || cuotasPagadasAhora.has('mp_cuota_3')) pagadasCount++;
        
        if (pagadasCount >= cantidadCuotasRegistrada) {
          esPagoTotal = true;
        }
      }

      // Determinar el nuevo estado de pago
      if (esPagoTotal) {
        nuevoEstadoPago = esPagoFamiliar ? "Pago Total Familiar" : "Pago total en cuotas";
      } else {
        nuevoEstadoPago = "Cuotas (En revisión)";
      }

      // Construir nombre de archivo
      const metodoPagoSimple = metodoPagoHoja.replace(/[\s()]/g, '');
      const estadoPagoSimple = nuevoEstadoPago.replace(/[\s()]/g, '');
      let baseNombreArchivo = esPagoFamiliar ? `${dniHoja}_${apellidoHoja}_${metodoPagoSimple}_${estadoPagoSimple}` : `${dniHoja}_${apellidoHoja}_${nombreHoja}_${metodoPagoSimple}_${estadoPagoSimple}`;
      const prefijoCuotas = cuotasSeleccionadas.map(c => c.replace('mp_', '')).join('-');
      if (metodoPagoHoja === 'Pago en Cuotas') {
         baseNombreArchivo = `${prefijoCuotas}_${baseNombreArchivo}`;
      }
      const nombreArchivoLimpio = baseNombreArchivo.replace(/[^\w.-]/g, '_');
      const extension = (fileData.fileName.includes('.')) ? fileData.fileName.split('.').pop() : 'jpg';
      const nuevoNombreArchivo = `${nombreArchivoLimpio}.${extension}`;
      Logger.log(`Nuevo nombre de archivo: ${nuevoNombreArchivo}`);
      
      const fileUrl = uploadFileToDrive(fileData.data, fileData.mimeType, nuevoNombreArchivo, dniLimpio, 'comprobante');
      if (typeof fileUrl !== 'string' || !fileUrl.startsWith('http')) {
        throw new Error("Error al subir el archivo a Drive: " + (fileUrl.message || 'Error desconocido'));
      }

      const nombrePagador = datosExtras.nombrePagador;
      const dniPagador = datosExtras.dniPagador;
      let mensajeExito = "";
      
      const aplicarCambios = (filaAfectada) => {
        hoja.getRange(filaAfectada, COL_PAGADOR_NOMBRE_MANUAL).setValue(nombrePagador);
        hoja.getRange(filaAfectada, COL_PAGADOR_DNI_MANUAL).setValue(dniPagador);
        hoja.getRange(filaAfectada, COL_ESTADO_PAGO).setValue(nuevoEstadoPago);
        
        if (esPagoTotal) {
            hoja.getRange(filaAfectada, COL_COMPROBANTE_MANUAL_TOTAL_EXT).setValue(fileUrl);
            hoja.getRange(filaAfectada, COL_CUOTA_1, 1, 3).setValues([["Pagada", "Pagada", "Pagada"]]);
        } else {
            cuotasSeleccionadas.forEach(cuota => {
                if(cuota === 'mp_cuota_1') hoja.getRange(filaAfectada, COL_COMPROBANTE_MANUAL_CUOTA1).setValue(fileUrl);
                if(cuota === 'mp_cuota_2') hoja.getRange(filaAfectada, COL_COMPROBANTE_MANUAL_CUOTA2).setValue(fileUrl);
                if(cuota === 'mp_cuota_3') hoja.getRange(filaAfectada, COL_COMPROBANTE_MANUAL_CUOTA3).setValue(fileUrl);
            });
        }
      };
      
      if (esPagoFamiliar) {
        const idFamiliar = rangoFila[COL_VINCULO_PRINCIPAL - 1];
        if (!idFamiliar) {
           Logger.log(`Pago Familiar marcado, pero no se encontró ID Familiar en fila ${fila}. Aplicando solo al DNI ${dniLimpio}.`);
           aplicarCambios(fila);
        } else {
          const rangoVinculos = hoja.getRange(2, COL_VINCULO_PRINCIPAL, hoja.getLastRow() - 1, 1);
          const todasLasFilas = rangoVinculos.createTextFinder(idFamiliar).matchEntireCell(true).findAll();
          let nombresActualizados = [];
          todasLasFilas.forEach(celda => {
            aplicarCambios(celda.getRow());
            nombresActualizados.push(hoja.getRange(celda.getRow(), COL_NOMBRE).getValue());
          });
          Logger.log(`Pago Familiar aplicado a ${nombresActualizados.length} miembros: ${nombresActualizados.join(', ')}`);
          mensajeExito = `¡Pago Familiar Total registrado con éxito para ${nombresActualizados.length} inscriptos!<br>${mensajeFinalCompleto}`;
        }
      } else {
        aplicarCambios(fila);
      }

      if (!mensajeExito) {
         if (esPagoTotal) {
            mensajeExito = mensajeFinalCompleto;
         } else {
            const pendientes = cantidadCuotasRegistrada - hoja.getRange(fila, COL_CUOTA_1, 1, 3).getValues()[0].filter(c => String(c).startsWith("Pagada")).length;
            mensajeExito = `Se registró el pago de la/s cuota/s.`;
         }
      }

      Logger.log(`Comprobante subido para DNI ${dniLimpio}. Estado final: ${nuevoEstadoPago}. ¿Familiar?: ${esPagoFamiliar}`);
      return { status: 'OK', message: mensajeExito, estadoPago: nuevoEstadoPago };
    } else {
      return { status: 'ERROR', message: `No se encontró el registro para el DNI ${dniLimpio}.` };
    }
  } catch (e) {
    Logger.log("Error en subirComprobanteManual: " + e.toString() + " Stack: " + e.stack);
    return { status: 'ERROR', message: 'Error en el servidor: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function uploadFileToDrive(data, mimeType, newFilename, dni, tipoArchivo) {
  try {
    if (!dni) return { status: 'ERROR', message: 'No se recibió DNI.' };
    let parentFolderId;
    switch (tipoArchivo) {
      case 'foto': parentFolderId = FOLDER_ID_FOTOS; break;
      case 'ficha': parentFolderId = FOLDER_ID_FICHAS; break;
      case 'comprobante': parentFolderId = FOLDER_ID_COMPROBANTES; break;
      default: return { status: 'ERROR', message: 'Tipo de archivo no reconocido.' };
    }
    if (!parentFolderId || parentFolderId.includes('AQUI_VA_EL_ID')) {
      return { status: 'ERROR', message: 'IDs de carpetas no configurados.' };
    }

    const parentFolder = DriveApp.getFolderById(parentFolderId);
    let subFolder;
    const folders = parentFolder.getFoldersByName(dni);
    subFolder = folders.hasNext() ? folders.next() : parentFolder.createFolder(dni);

    const decodedData = Utilities.base64Decode(data.split(',')[1]);
    const blob = Utilities.newBlob(decodedData, mimeType, newFilename); 
    const file = subFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();

  } catch (e) {
    Logger.log('Error en uploadFileToDrive: ' + e.toString());
    return { status: 'ERROR', message: 'Error al subir archivo: ' + e.message };
  }
}

// =========================================================
// --- (FIN DE MODIFICACIÓN) ---
// =========================================================

function actualizarDatosPersonales(dni, datosEditados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dniLimpio = limpiarDNI(dni);
    if (!dniLimpio || !datosEditados) return { status: 'ERROR', message: 'Faltan datos (DNI o datos a editar).' };
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hoja) throw new Error(`La hoja "${NOMBRE_HOJA_REGISTRO}" no fue encontrada.`);
    const rangoDni = hoja.getRange(2, COL_DNI_INSCRIPTO, hoja.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDni.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) {
      const fila = celdaEncontrada.getRow();
      if (datosEditados.adultoResponsable1 !== undefined) hoja.getRange(fila, COL_ADULTO_RESPONSABLE_1).setValue(datosEditados.adultoResponsable1);
      if (datosEditados.dniResponsable1 !== undefined) hoja.getRange(fila, COL_DNI_RESPONSABLE_1).setValue(datosEditados.dniResponsable1);
      if (datosEditados.telResp1 !== undefined) hoja.getRange(fila, COL_TEL_RESPONSABLE_1).setValue(datosEditados.telResp1);
      if (datosEditados.adultoResponsable2 !== undefined) hoja.getRange(fila, COL_ADULTO_RESPONSABLE_2).setValue(datosEditados.adultoResponsable2);
      if (datosEditados.telResp2 !== undefined) hoja.getRange(fila, COL_TEL_RESPONSABLE_2).setValue(datosEditados.telResp2);
      if (datosEditados.personasAutorizadas !== undefined) hoja.getRange(fila, COL_PERSONAS_AUTORIZADAS).setValue(datosEditados.personasAutorizadas);
      if (datosEditados.urlCertificadoAptitud !== undefined && datosEditados.urlCertificadoAptitud !== "") hoja.getRange(fila, COL_APTITUD_FISICA).setValue(datosEditados.urlCertificadoAptitud);
      Logger.log(`Datos personales actualizados para DNI ${dniLimpio} en fila ${fila}.`);
      return { status: 'OK', message: '¡Datos actualizados con éxito!' };
    } else {
      return { status: 'ERROR', message: `No se encontró el registro para el DNI ${dniLimpio}.` };
    }
  } catch (e) {
    Logger.log("Error en actualizarDatosPersonales: " + e.toString());
    return { status: 'ERROR', message: 'Error en el servidor: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function aplicarColorGrupo(hoja, fila, textoGrupo, hojaConfig) {
  try {
    const rangoGrupos = hojaConfig.getRange("A30:B41");
    const valoresGrupos = rangoGrupos.getValues();
    const coloresGrupos = rangoGrupos.getBackgrounds();
    for (let i = 0; i < valoresGrupos.length; i++) {
      if (valoresGrupos[i][0] == textoGrupo) {
        hoja.getRange(fila, COL_GRUPOS).setBackground(coloresGrupos[i][1]);
        return;
      }
    }
  } catch (e) {
    Logger.log(`Error al aplicar color para el grupo ${textoGrupo} en fila ${fila}: ${e.message}`);
  }
}

function limpiarDNI(dni) {
  if (!dni) return '';
  return String(dni).replace(/[.\s-]/g, '').trim();
}

function calcularEdad(fechaNacimientoStr) {
  if (!fechaNacimientoStr) return { anos: 0, meses: 0, dias: 0 };
  const fechaNacimiento = new Date(fechaNacimientoStr);
  const hoy = new Date();
  fechaNacimiento.setMinutes(fechaNacimiento.getMinutes() + fechaNacimiento.getTimezoneOffset());
  let anos = hoy.getFullYear() - fechaNacimiento.getFullYear();
  let meses = hoy.getMonth() - fechaNacimiento.getMonth();
  let dias = hoy.getDate() - fechaNacimiento.getDate();
  if (dias < 0) {
    meses--;
    dias += new Date(hoy.getFullYear(), hoy.getMonth(), 0).getDate();
  }
  if (meses < 0) {
    anos--;
    meses += 12;
  }
  return { anos, meses, dias };
}

function obtenerEstadoRegistro() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hojaConfig) throw new Error(`Hoja "${NOMBRE_HOJA_CONFIG}" no encontrada.`);
    const limiteCupos = parseInt(hojaConfig.getRange('B1').getValue()) || 100;
    const limiteJornadaExtendida = parseInt(hojaConfig.getRange('B4').getValue());
    const formularioAbierto = hojaConfig.getRange('B11').getValue() === true;
    let registrosActuales = 0;
    let registrosJornadaExtendida = 0;
    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      const lastRow = hojaRegistro.getLastRow();
      registrosActuales = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1).getValues().filter(fila => fila[0] != null && fila[0] != "").length;
      registrosJornadaExtendida = hojaRegistro.getRange(2, COL_MARCA_N_E_A, lastRow - 1, 1).getValues().filter(row => String(row[0]).startsWith('Extendida')).length;
    }
    hojaConfig.getRange('B2').setValue(registrosActuales);
    hojaConfig.getRange('B5').setValue(registrosJornadaExtendida);
    return { alcanzado: registrosActuales >= limiteCupos, jornadaExtendidaAlcanzada: registrosJornadaExtendida >= limiteJornadaExtendida, cierreManual: !formularioAbierto };
  } catch (e) {
    Logger.log("Error en obtenerEstadoRegistro: " + e.message);
    return { cierreManual: true, message: "Error al leer config: " + e.message };
  }
}

function validarAcceso(dni, tipoInscripto) {
  try {
    if (!dni || !/^[0-9]{8}$/.test(dni.trim())) return { status: 'ERROR', message: 'El DNI debe tener exactamente 8 dígitos numéricos.' };
    const dniLimpio = limpiarDNI(dni);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    if (!hojaConfig) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_CONFIG}" no fue encontrada.` };
    const pagoTotalMPVisible = hojaConfig.getRange('B24').getValue() === true;
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);

    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      const celdaRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1).createTextFinder(dniLimpio).matchEntireCell(true).findNext();
      if (celdaRegistro) {
        const estado = obtenerEstadoRegistro();
        if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };
        return gestionarUsuarioYaRegistrado(ss, hojaRegistro, celdaRegistro.getRow(), dniLimpio, estado, tipoInscripto, pagoTotalMPVisible);
      }
    }

    const estado = obtenerEstadoRegistro();
    if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };
    if (estado.alcanzado && tipoInscripto !== 'preventa') return { status: 'LIMITE_ALCANZADO', message: 'Se ha alcanzado el cupo máximo para nuevos registros.' };

    const hojaPreventa = ss.getSheetByName(NOMBRE_HOJA_PREVENTA);
    if (tipoInscripto === 'preventa') {
      if (!hojaPreventa) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_PREVENTA}" no fue encontrada.` };
      const celdaEncontrada = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1).createTextFinder(dniLimpio).matchEntireCell(true).findNext();
      if (!celdaEncontrada) return { status: 'ERROR_TIPO_ANT', message: `El DNI ${dniLimpio} no se encuentra en la base de datos de Pre-Venta.` };
      
      const fila = hojaPreventa.getRange(celdaEncontrada.getRow(), 1, 1, hojaPreventa.getLastColumn()).getValues()[0];
      const jornadaGuarda = String(fila[COL_PREVENTA_GUARDA - 1]).trim().toLowerCase();
      const jornadaPredefinida = (jornadaGuarda.includes('si') || jornadaGuarda.includes('extendida')) ? 'Jornada Normal extendida' : 'Jornada Normal';
      if (jornadaPredefinida === 'Jornada Normal extendida' && estado.jornadaExtendidaAlcanzada) return { status: 'LIMITE_EXTENDIDA', message: 'Su DNI de Pre-Venta corresponde a Jornada Extendida, pero el cupo ya se ha agotado.' };
      
      const fechaNacimientoRaw = fila[COL_PREVENTA_FECHA_NAC - 1];
      const fechaNacimientoStr = (fechaNacimientoRaw instanceof Date) ? Utilities.formatDate(fechaNacimientoRaw, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '';
      return { status: 'OK_PREVENTA', message: '✅ DNI de Pre-Venta validado. Se autocompletarán sus datos.', datos: { email: fila[COL_PREVENTA_EMAIL - 1], nombre: fila[COL_PREVENTA_NOMBRE - 1], apellido: fila[COL_PREVENTA_APELLIDO - 1], dni: dniLimpio, fechaNacimiento: fechaNacimientoStr, jornada: jornadaPredefinida, esPreventa: true }, jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada, tipoInscripto: tipoInscripto, pagoTotalMPVisible: pagoTotalMPVisible };
    }

    const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);
    if (!hojaBusqueda) return { status: 'ERROR', message: `La hoja "${NOMBRE_HOJA_BUSQUEDA}" no fue encontrada.` };
    const celdaEncontrada = hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1).createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) { 
      if (hojaPreventa && hojaPreventa.getLastRow() > 1 && hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1).createTextFinder(dniLimpio).matchEntireCell(true).findNext()) {
        return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
      }
      if (tipoInscripto === 'nuevo') return { status: 'ERROR_TIPO_NUEVO', message: "El DNI se encuentra en nuestra base de datos. Por favor, seleccione 'Soy Inscripto Anterior' y valide nuevamente." };
      
      const fila = hojaBusqueda.getRange(celdaEncontrada.getRow(), COL_HABILITADO_BUSQUEDA, 1, 10).getValues()[0];
      if (fila[0] !== true) return { status: 'NO_HABILITADO', message: 'El DNI se encuentra en la base de datos, pero no está habilitado para la inscripción.' };
      
      const fechaNacimientoRaw = fila[3];
      const fechaNacimientoStr = (fechaNacimientoRaw instanceof Date) ? Utilities.formatDate(fechaNacimientoRaw, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '';
      return { status: 'OK', datos: { nombre: fila[1], apellido: fila[2], dni: dniLimpio, fechaNacimiento: fechaNacimientoStr, obraSocial: String(fila[6] || '').trim(), colegioJardin: String(fila[7] || '').trim(), adultoResponsable1: String(fila[8] || '').trim(), esPreventa: false }, edad: calcularEdad(fechaNacimientoStr), jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada, tipoInscripto: tipoInscripto, pagoTotalMPVisible: pagoTotalMPVisible };
    } else { 
      if (hojaPreventa && hojaPreventa.getLastRow() > 1 && hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1).createTextFinder(dniLimpio).matchEntireCell(true).findNext()) {
        return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
      }
      if (tipoInscripto === 'anterior') return { status: 'ERROR_TIPO_ANT', message: "No se encuentra en la base de datos de años anteriores. Por favor, seleccione 'Soy Nuevo Inscripto'." };
      return { status: 'OK_NUEVO', message: '✅ DNI validado. Proceda al registro.', jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada, tipoInscripto: tipoInscripto, datos: { dni: dniLimpio, esPreventa: false }, pagoTotalMPVisible: pagoTotalMPVisible };
    }
  } catch (e) {
    Logger.log("Error en validarAcceso: " + e.message + " Stack: " + e.stack);
    return { status: 'ERROR', message: 'Ocurrió un error al validar el DNI. ' + e.message };
  }
}

function gestionarUsuarioYaRegistrado(ss, hojaRegistro, filaRegistro, dniLimpio, estado, tipoInscripto, pagoTotalMPVisible) {
  const rangoFila = hojaRegistro.getRange(filaRegistro, 1, 1, hojaRegistro.getLastColumn()).getValues()[0];
  const estadoPago = rangoFila[COL_ESTADO_PAGO - 1];
  const metodoPago = rangoFila[COL_METODO_PAGO - 1];
  const nombreRegistrado = rangoFila[COL_NOMBRE - 1] + ' ' + rangoFila[COL_APELLIDO - 1];
  const estadoInscripto = rangoFila[COL_ESTADO_NUEVO_ANT - 1];
  const estadoInscriptoTrim = estadoInscripto ? String(estadoInscripto).trim().toLowerCase() : "";

  if ((estadoInscriptoTrim.includes('anterior') && tipoInscripto !== 'anterior') || (estadoInscriptoTrim.includes('nuevo') && tipoInscripto !== 'nuevo') || (estadoInscriptoTrim.includes('pre-venta') && tipoInscripto !== 'preventa')) {
    return { status: 'ERROR', message: `Este DNI ya está registrado como "${estadoInscripto}". Por favor, seleccione esa opción y valide de nuevo.` };
  }

  // --- (MODIFICACIÓN) ---
  // Añadir flag para saber si tiene hermanos y enviarlo al cliente
  const idFamiliar = rangoFila[COL_VINCULO_PRINCIPAL - 1];
  let tieneHermanos = false;
  if (idFamiliar) {
    const count = hojaRegistro.getRange(2, COL_VINCULO_PRINCIPAL, hojaRegistro.getLastRow() - 1, 1).getValues().filter(v => v[0] == idFamiliar).length;
    if (count > 1) tieneHermanos = true;
  }
  // --- (FIN MODIFICACIÓN) ---
  
  const datosParaEdicion = { dni: dniLimpio, email: rangoFila[COL_EMAIL - 1] || '', adultoResponsable1: rangoFila[COL_ADULTO_RESPONSABLE_1 - 1] || '', dniResponsable1: rangoFila[COL_DNI_RESPONSABLE_1 - 1] || '', telResponsable1: rangoFila[COL_TEL_RESPONSABLE_1 - 1] || '', adultoResponsable2: rangoFila[COL_ADULTO_RESPONSABLE_2 - 1] || '', telResponsable2: rangoFila[COL_TEL_RESPONSABLE_2 - 1] || '', personasAutorizadas: rangoFila[COL_PERSONAS_AUTORIZADAS - 1] || '', urlCertificadoAptitud: rangoFila[COL_APTITUD_FISICA - 1] || '' };
  
  if (estadoInscriptoTrim.includes('hermano/a') && !metodoPago) { 
    let faltantes = [];
    if (!rangoFila[COL_COLEGIO_JARDIN - 1]) faltantes.push('Colegio');
    if (!rangoFila[COL_FOTO_CARNET - 1]) faltantes.push('Foto Carnet');
    if (!rangoFila[COL_JORNADA - 1]) faltantes.push('Jornada');
    if (!rangoFila[COL_METODO_PAGO - 1]) faltantes.push('Método de Pago');
    
    const datosCompletos = { ...datosParaEdicion, nombre: rangoFila[COL_NOMBRE - 1], apellido: rangoFila[COL_APELLIDO - 1], fechaNacimiento: rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1] ? Utilities.formatDate(new Date(rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1]), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '', obraSocial: rangoFila[COL_OBRA_SOCIAL - 1] || '', colegioJardin: rangoFila[COL_COLEGIO_JARDIN - 1] || '' };
    return { status: 'HERMANO_COMPLETAR', message: `⚠️ ¡Hola ${datosCompletos.nombre}! Eres un hermano/a pre-registrado. Por favor, complete/verifique TODOS los campos.`, datos: datosCompletos, jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada, tipoInscripto: estadoInscripto, pagoTotalMPVisible: pagoTotalMPVisible };
  }

  let estadoPagoActual = estadoPago;
  const c_total = rangoFila[COL_COMPROBANTE_MANUAL_TOTAL_EXT - 1], c_c1 = rangoFila[COL_COMPROBANTE_MANUAL_CUOTA1 - 1], c_c2 = rangoFila[COL_COMPROBANTE_MANUAL_CUOTA2 - 1], c_c3 = rangoFila[COL_COMPROBANTE_MANUAL_CUOTA3 - 1];
  const tieneComprobantes = c_total || c_c1 || c_c2 || c_c3;

  if (!tieneComprobantes && (String(estadoPagoActual).includes('En revisión') || String(estadoPagoActual).includes('Pagado') || String(estadoPagoActual).includes('Total'))) {
    Logger.log(`Corrección de estado para DNI ${dniLimpio}: El estado era '${estadoPagoActual}' pero no hay comprobantes. Reseteando.`);
    estadoPagoActual = metodoPago === 'Pago en Cuotas' ? `Pendiente (${rangoFila[COL_CANTIDAD_CUOTAS - 1] || 3} Cuotas)` : "Pendiente (Transferencia)";
    hojaRegistro.getRange(filaRegistro, COL_ESTADO_PAGO).setValue(estadoPagoActual);
    hojaRegistro.getRange(filaRegistro, COL_CUOTA_1, 1, 3).clearContent();
  }

  const baseResponse = { status: 'REGISTRO_ENCONTRADO', adeudaAptitud: !rangoFila[COL_APTITUD_FISICA - 1], metodoPago: metodoPago, pagoTotalMPVisible: pagoTotalMPVisible, datos: datosParaEdicion, tieneHermanos: tieneHermanos };

  if (String(estadoPagoActual).includes('Pagado') || String(estadoPagoActual).includes('Pago Total')) {
    return { ...baseResponse, message: `✅ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO y la inscripción está PAGADA (${estadoPagoActual}).`, proximaCuotaPendiente: null };
  }
  
  let proximaCuotaPendiente = null;
  if (metodoPago === 'Pago en Cuotas') {
    const cuotas = [rangoFila[COL_CUOTA_1 - 1], rangoFila[COL_CUOTA_2 - 1], rangoFila[COL_CUOTA_3 - 1]];
    if (!String(cuotas[0]).startsWith("Pagada")) proximaCuotaPendiente = "C1";
    else if (!String(cuotas[1]).startsWith("Pagada")) proximaCuotaPendiente = "C2";
    else if (!String(cuotas[2]).startsWith("Pagada")) proximaCuotaPendiente = "C3";
  }

  if (String(estadoPagoActual).includes('En revisión')) {
    let mensajeRevision = `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. Su pago está "En revisión".`;
    if (proximaCuotaPendiente) mensajeRevision += ` Le quedan cuotas pendientes.`;
    return { ...baseResponse, message: mensajeRevision, proximaCuotaPendiente: proximaCuotaPendiente };
  }

  return { ...baseResponse, message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. El pago (${metodoPago}) está PENDIENTE.`, proximaCuotaPendiente: proximaCuotaPendiente || 'subir_comprobante_manual' };
}