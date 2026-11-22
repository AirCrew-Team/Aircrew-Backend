// Content-Disposition de una descarga (RFC 6266): filename en ASCII para
// clientes antiguos (Node rechaza otros caracteres en las cabeceras) y
// filename* en UTF-8 con el nombre real, que los navegadores prefieren.
function attachmentDisposition(name, fallback) {
  // Sin rutas, comillas ni caracteres de control. toWellFormed: un carácter
  // UTF-16 suelto haría fallar a encodeURIComponent.
  const realName =
    String(name)
      .toWellFormed()
      .split(/[\\/]/)
      .pop()
      .replace(/["\u0000-\u001f\u007f]/g, '')
      .trim() || fallback;

  const asciiName =
    realName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .trim() || fallback;

  // encodeURIComponent deja ' ( ) *, que RFC 5987 no admite sin codificar.
  const encodedName = encodeURIComponent(realName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

module.exports = { attachmentDisposition };
