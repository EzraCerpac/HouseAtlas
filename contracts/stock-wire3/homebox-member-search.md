# HomeBox field and maintenance member search

This document defines the HouseAtlas local selector for `homebox.field.list`
and `homebox.maintenance.list`. It extends the stock.2 wire3 list-query
semantics without changing the wire schema or the original HomeBox request.
It is a member selector over a complete native observation, not the upstream
entity search endpoint or evidence of a provider-side search.

## Matching

An omitted `q` selects every member. An explicitly empty string also selects
every member, while remaining an explicitly empty string in the original
intent and cursor binding. Omission and empty are not normalized into one
query. Null remains invalid. The schema's 255 Unicode-code-point string limit
remains unchanged.

For a nonempty `q`, select a member if any of the public matching strings
defined below contains the query after applying Rust Unicode
`str::to_lowercase` separately to that string and the query. Match each string
independently; do not concatenate name and value or description. This is
locale-independent lowercase substring matching,
not full Unicode case folding. Do not trim whitespace, normalize Unicode,
remove accents, tokenize, parse operators or interpret wildcard characters.
Whitespace and punctuation are literal parts of the query. The original
strings remain unchanged in the captured observation, request and result.

For fields, match `data.name`, the actual native field name, and its validated
public `data.value` when available. A text value contributes its original
string. A number contributes the base-10 signed integer representation of
the validated public value, without separators or a leading plus sign. A
boolean contributes exactly `true` or `false`. Do not match the value's kind
tag, JSON syntax or unavailable reason. The pinned native baseline does not
expose a time value; its explicit unavailable arm contributes no value string,
so a time field can match only its name. No missing or unavailable value is
replaced by an empty string, zero, false, a date or a descriptive placeholder.

For maintenance, match `data.name`, the actual native entry name, and its
actual public `data.description` string when supplied. A null description
is not admitted by the existing member contract; an omitted description
contributes no matching string, and an explicitly empty description remains
empty. Preserve the pinned native decoder's required-string validation.
Do not match owner names, labels from another record, identifiers, dates, cost,
hidden raw properties or JSON serialization. Retain every value's existing
typed projection and lexical source facts. A match establishes no additional
value availability or physical placement.

## Capture, order and pagination

Decode and validate every member of the complete native observation before
applying the selector, including members that do not match. Retain the full
original bytes, complete ordered normalized members, references, parent
relations, Source identity and current baseline. Search does not reduce the
authority or observation graph that must be revalidated on each phase.

Keep selected positions in ascending original native order. Pagination walks
those positions; it neither sorts by identifier nor reorders matches. Count
and reserve the complete selected continuation chain before returning its
first page. Apply the existing raw/decode/work/retention bounds to the full
capture and the fixed token cap to the selected continuation chain. A zero
match result is an empty list with no continuation, not proof of absence
outside this observation or permission to skip validation.

Bind every cursor to the exact original query, including omitted versus
empty `q`, scope, configured Source and request's original session custody.
Changing a query is a new read, not a continuation or window renewal. No
extra provider GET, substitute principal, callback selector, caller-made
capture or filtered cache publication is introduced.

## Qualification

This definition permits a concrete configured complete-capture implementation
under the existing Source and Root phase fences. A schema-valid query alone
does not establish that an arbitrary reader or transport supports search.
Generic reader paths retain their explicit capability exclusions until they
implement this complete-observation selector themselves. Source compilation,
contract review and provider/runtime qualification remain separate evidence.
