const text = value => typeof value === "string" ? value.trim() : "";

export function commercialEmail(value) {
  const email = text(value);
  return /^[^\s@?#&,;<>]+@[^\s@?#&,;<>]+\.[^\s@?#&,;<>]+$/.test(email) ? email : "";
}

// Only public commercial contacts; never substitute an account operator.
export function commercialContacts(company) {
  return (Array.isArray(company?.contacts) ? company.contacts : [])
    .filter(contact => contact && typeof contact === "object")
    .map(contact => ({
      name: text(contact.name),
      position: text(contact.position),
      email: commercialEmail(contact.email),
      phone: /\d/.test(text(contact.phone)) ? text(contact.phone) : "",
    }))
    .filter(contact => contact.email || contact.phone);
}
