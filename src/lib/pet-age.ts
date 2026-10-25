const calendar = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function getPetAge(birthday: string, now = new Date()) {
  const [birthYear, birthMonth, birthDay] = birthday.split("-").map(Number);
  const parts = calendar.formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const totalMonths = Math.max(0,
    (part("year") - birthYear) * 12 + part("month") - birthMonth - Number(part("day") < birthDay),
  );
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  return {
    short: `${years}y ${months}m`,
    long: `${years} year${years === 1 ? "" : "s"}, ${months} month${months === 1 ? "" : "s"} old`,
  };
}
