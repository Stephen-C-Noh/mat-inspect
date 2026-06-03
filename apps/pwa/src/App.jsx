import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEquipment } from "./api/equipment";

function getCardClass(status) {
  if (status === "SAFE") return "bg-green-50 border-green-500";
  if (status === "WARNING") return "bg-yellow-50 border-yellow-500";
  if (status === "DANGER") return "bg-red-50 border-red-500";
  return "bg-white border-gray-300";
}

function getBadgeClass(status) {
  if (status === "SAFE") return "bg-green-600";
  if (status === "WARNING") return "bg-yellow-500";
  if (status === "DANGER") return "bg-red-600";
  return "bg-gray-500";
}

export default function App() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["equipment"],
    queryFn: fetchEquipment,
  });

  const [search, setSearch] = useState("");

  const filteredData =
    data?.filter((item) => {
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.assetTag.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q)
      );
    }) || [];

  return (
    <div className="min-h-screen bg-gray-100 p-10 text-center">
      <h1 className="text-2xl font-bold mb-3">
        Equipment Inspection Dashboard
      </h1>

      <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-md">
        {/* SEARCH */}
        <input
          className="w-full p-3 border rounded-lg mb-5 focus:outline-none focus:ring-2 focus:ring-green-400"
          placeholder="Search equipment, tag, or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* LOADING */}
        {isLoading && (
          <p className="text-gray-600 py-6">Loading equipment...</p>
        )}

        {/* ERROR */}
        {error && (
          <p className="text-red-600 py-6">Failed to load equipment</p>
        )}

        {/* EMPTY STATE */}
        {!isLoading && !error && filteredData.length === 0 && (
          <div className="text-gray-500 py-10 border rounded-lg bg-gray-50">
            No equipment found matching your search
          </div>
        )}

        {/* LIST */}
        <div className="flex flex-col gap-3">
          {filteredData.map((item) => (
            <div
              key={item.id}
              className={
                "flex justify-between items-center p-4 rounded-lg shadow-sm border transition hover:shadow-md " +
                getCardClass(item.safety)
              }
            >
              {/* LEFT SIDE */}
              <div className="text-left">
                <h3 className="text-lg font-semibold">{item.name}</h3>

                <p className="text-sm text-gray-600">
                  {item.assetTag} • {item.location}
                </p>

                <p className="text-xs text-gray-500">
                  Last Inspection: {item.lastInspection}
                </p>

                <p className="text-xs text-gray-500">
                  Inspector: {item.inspectedBy}
                </p>
              </div>

              {/* BADGE */}
              <span
                className={
                  "text-white px-3 py-1 rounded-full text-xs font-bold " +
                  getBadgeClass(item.safety)
                }
              >
                {item.safety}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
