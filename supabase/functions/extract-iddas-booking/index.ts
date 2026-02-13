function looksLikeCompanyName(name: string) {
  const n = name.trim().toUpperCase();
  if (!n) return true;
  if (n.startsWith("RESERVADO POR")) return true;
  // padrões comuns de empresa
  const companyTokens = ["LTDA", "LTD", "EIRELI", "ME", "S/A", "SA", "SOCIEDADE", "EMPRESA", "ADMINISTRACAO", "ADMINISTRAÇÃO"];
  return companyTokens.some(t => n.includes(t));
}

function cleanName(name: string) {
  return name
    .replace(/^[-•\s]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parsePassengersFromText(text: string): Passenger[] {
  const rawLines = text
    .split("\n")
    .map(l => l.replace(/\u00A0/g, " ").trim())
    .filter(Boolean);

  const passengers: Passenger[] = [];
  let lastNameCandidate = "";

  for (const line of rawLines) {
    const upper = line.toUpperCase();

    // ignora cabeçalhos
    if (upper.startsWith("PASSAGEIROS:") || upper.startsWith("PASSAGEIRO")) continue;
    if (upper.startsWith("RESERVADO POR")) {
      lastNameCandidate = "";
      continue;
    }

    const hasCPF = /CPF[:\s]/i.test(line) || /\bCPF\b/i.test(line);
    const cpfMatch = line.match(/CPF[:\s]*([0-9.\-]+)/i);
    const birthMatch =
      line.match(/\bNASC[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) ||
      line.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);
    const phoneMatch = line.match(/\b(?:TEL|Telefone)[:\s]*\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/i);
    const emailMatch = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const passportMatch = line.match(/\bPassaporte[:\s]*([A-Z0-9]+)/i);

    // tenta tirar o nome da própria linha
    let nameCandidate = cleanName(
      line
        .replace(/,\s*/g, " ")
        .replace(/\bCPF\b.*$/i, "")
        .replace(/\bNASC\b.*$/i, "")
        .replace(/\bTEL\b.*$/i, "")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "")
        .trim()
    );

    // se a linha não tem CPF e parece ser só nome, guarda como "último nome"
    if (!hasCPF) {
      const maybeName = cleanName(line);
      if (maybeName && !looksLikeCompanyName(maybeName) && maybeName.length >= 4) {
        lastNameCandidate = maybeName;
      }
      continue;
    }

    // se tem CPF, mas não achou nome na linha, usa o nome anterior
    if (!nameCandidate || looksLikeCompanyName(nameCandidate)) {
      nameCandidate = lastNameCandidate;
    }

    // se ainda assim não tem nome, ignora esse item (evita cards sem nome)
    if (!nameCandidate || looksLikeCompanyName(nameCandidate)) continue;

    passengers.push({
      fullName: nameCandidate,
      cpf: cpfMatch?.[1] ?? "",
      birthDate: birthMatch?.[1] ?? "",
      phone: phoneMatch?.[0] ?? "",
      email: emailMatch?.[0] ?? "",
      passport: passportMatch?.[1] ?? "",
      rawText: line,
    });
  }

  // remove duplicados por CPF (se vier repetido)
  const seen = new Set<string>();
  return passengers.filter(p => {
    const key = (p.cpf || p.fullName).trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
